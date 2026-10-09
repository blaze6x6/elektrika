import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockForHour, blocksOccurringOn, isNonWorkingDay, isPublicHoliday, solarBlockShares, activeBlocksForMonth,
} from "../src/lib/blocks.ts";

// Referenčna tabela iz Priloge 2 (ura → [višja delovni, nižja delovni, višja dela prost, nižja dela prost])
const TABLE: Record<string, [number, number, number, number]> = {
  "0-5": [3, 4, 4, 5], "6": [2, 3, 3, 4], "7-13": [1, 2, 2, 3], "14-15": [2, 3, 3, 4],
  "16-19": [1, 2, 2, 3], "20-21": [2, 3, 3, 4], "22-23": [3, 4, 4, 5],
};
const SAMPLE = ["2026-01-14", "2026-06-17", "2026-01-17", "2026-06-20"]; // sre, sre, sob, sob

test("blockForHour ustreza uradni tabeli", () => {
  for (const [range, expected] of Object.entries(TABLE)) {
    const [a, b] = range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
    for (let h = a; h <= b; h++) SAMPLE.forEach((d, i) => assert.equal(blockForHour(d, h), expected[i], `${d} ura ${h}`));
  }
});

test("prazniki in vikendi so dela prosti", () => {
  assert.ok(isPublicHoliday("2026-04-06")); // velikonočni ponedeljek 2026
  assert.ok(isPublicHoliday("2025-04-21")); // velikonočni ponedeljek 2025
  assert.ok(isPublicHoliday("2026-12-25"));
  assert.ok(!isPublicHoliday("2026-09-17"));
  assert.ok(isNonWorkingDay("2026-10-10")); // sobota
  assert.ok(!isNonWorkingDay("2026-10-09")); // petek
  // praznik v višji sezoni na delovni dan → brez bloka 1
  assert.ok(!blocksOccurringOn("2026-12-25").includes(1));
});

test("bloki, ki se v mesecu pojavijo", () => {
  assert.deepEqual(activeBlocksForMonth(1), [1, 2, 3, 4]);
  assert.deepEqual(activeBlocksForMonth(7), [2, 3, 4, 5]);
  assert.deepEqual(blocksOccurringOn("2026-01-14"), [1, 2, 3]);
  assert.deepEqual(blocksOccurringOn("2026-06-20"), [3, 4, 5]);
});

test("solarBlockShares: vsota 1, smiselni razredi", () => {
  for (const d of ["2026-01-14", "2026-06-17", "2026-06-20", "2026-12-25"]) {
    const s = solarBlockShares(d);
    assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
  const summerWork = solarBlockShares("2026-06-17");
  assert.equal(summerWork[0], 0);          // brez bloka 1
  assert.ok(summerWork[1] > 0.6);          // večina v bloku 2
  assert.ok(summerWork[2] > 0.15);         // delež v "vmesnem" bloku 3 je znaten
  const summerOff = solarBlockShares("2026-06-20");
  assert.ok(summerOff[2] > 0.6 && summerOff[1] === 0); // vikend: blok 3 + blok 4
  const winterWork = solarBlockShares("2026-01-14");
  assert.ok(winterWork[0] > 0.6);
});

import { hourlyWhToBlocks } from "../src/lib/blocks.ts";

test("hourlyWhToBlocks: urne meritve → bloki (poletni delovnik)", () => {
  // sreda, 17. 6. 2026 (nižja sezona, delovni dan): 13:00 → blok 2, 14:00 → blok 3, 20:00 → blok 3
  const m = hourlyWhToBlocks([
    { date: "2026-06-17 13:00:00", value: 4000 },
    { date: "2026-06-17 14:00:00", value: 3000 },
    { date: "2026-06-17 15:00:00", value: 1000 },
    { date: "2026-06-17 16:00:00", value: 500 },
    { date: "2026-06-17 20:00:00", value: 0 },
    { date: "2026-06-17 21:00:00", value: null },
  ]);
  assert.deepEqual(m.get("2026-06-17"), [0, 4.5, 4, 0, 0]);
  // sobota: isti urni vzorec pade en blok višje
  const w = hourlyWhToBlocks([{ date: "2026-06-20 13:00:00", value: 2000 }, { date: "2026-06-20 14:00:00", value: 1000 }]);
  assert.deepEqual(w.get("2026-06-20"), [0, 0, 2, 1, 0]);
  assert.equal(hourlyWhToBlocks([{ date: "x", value: 1 }, { date: "2026-06-17 00:00:00", value: null }]).size, 0);
});

import { aggregateMeIntervals, localIntervalStart } from "../src/lib/blocks.ts";

test("MojElektro 15-min odčitki → bloki (žig = konec intervala)", () => {
  const A = "A+", O = "A-";
  const r = (timestamp: string, value: number) => ({ timestamp, value });
  // sreda 17. 6. 2026 (nižja sezona, delovni dan): interval 13:45–14:00 (žig 14:00) → blok 2 (ura 13); 14:00–14:15 (žig 14:15) → blok 3
  const m = aggregateMeIntervals([
    { readingType: A, intervalReadings: [r("2026-06-17T14:00:00", 1), r("2026-06-17T14:15:00", 2), r("2026-06-18T00:00:00", 0.5)] },
    { readingType: O, intervalReadings: [{ d: "2026-06-17 12:15:00", v: "3" }] },
  ], A, O, "end");
  assert.deepEqual([m.get("2026-06-17")!.blok2, m.get("2026-06-17")!.blok3], [1, 2]);
  assert.equal(m.get("2026-06-17")!.oddaja, 3);
  // žig 00:00 naslednjega dne pripada zadnji uri prejšnjega dne (blok 4 v nižji sezoni, delovnik 23. ura)
  assert.equal(m.get("2026-06-17")!.blok4, 0.5);
  assert.equal(m.get("2026-06-17")!.uvoz, 3.5);
  // v načinu "start" ostane žig 14:00 v bloku 3
  const s = aggregateMeIntervals([{ readingType: A, intervalReadings: [r("2026-06-17T14:00:00", 1)] }], A, O, "start");
  assert.equal(s.get("2026-06-17")!.blok3, 1);
});

test("localIntervalStart: odmik in poletni čas", () => {
  // 2026-06-17T12:15:00Z = 14:15 CEST → interval, ki se je končal ob 14:15, se je začel ob 14:00
  assert.deepEqual(localIntervalStart("2026-06-17T12:15:00Z", 15, "end"), { date: "2026-06-17", hour: 14 });
  assert.deepEqual(localIntervalStart("2026-01-14T00:00:00+01:00", 15, "end"), { date: "2026-01-13", hour: 23 });
});
