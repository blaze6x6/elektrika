import test from "node:test";
import assert from "node:assert/strict";
import { resolveTariff, tariffKey, DEFAULT_TARIFF } from "../src/lib/tariff.ts";

test("tarife po letih: lastno leto, prenos iz prejšnjega, stari ključi, privzeto", () => {
  const s: Record<string, string> = {
    tariff_cena_energija_et: "0.10",                 // stari splošni ključ
    [tariffKey(2025, "cena_energija_et")]: "0.12",
    [tariffKey(2025, "moc_blok1")]: "6.0",
    [tariffKey(2026, "cena_energija_et")]: "0.15",
  };
  const y26 = resolveTariff(s, 2026);
  assert.equal(y26.values.cena_energija_et, 0.15);
  assert.equal(y26.values.moc_blok1, 6.0); // manjkajoč ključ iz prejšnjega leta
  assert.equal(y26.source.kind, "year");
  const y27 = resolveTariff(s, 2027);
  assert.equal(y27.values.cena_energija_et, 0.15);
  assert.deepEqual(y27.source, { kind: "inherited", fromYear: 2026 });
  const y24 = resolveTariff(s, 2024);
  assert.equal(y24.values.cena_energija_et, 0.10);  // pred prvim letom → stari ključ
  assert.equal(y24.source.kind, "legacy");
  const none = resolveTariff({}, 2026);
  assert.equal(none.values.ddv_stopnja, DEFAULT_TARIFF.ddv_stopnja);
  assert.equal(none.source.kind, "default");
});
