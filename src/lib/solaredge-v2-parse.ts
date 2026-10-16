import { hourlyWhToBlocks, localIntervalStart } from "./blocks";

/**
 * Razčlenjevanje odgovora SolarEdge v2 »Meter Telemetry«
 * (GET /v2/sites/{id}/meters/telemetry, resolution=HOUR|DAY).
 *
 * Oblika: { meters: { "<serijska>": { productionEnergy: { unit: "WH", values: [{ timestamp, value }] }, … } } }
 * Časovni žig = ZAČETEK intervala. Čiste funkcije (brez baze in omrežja) → testi.
 */

/** ts = začetek intervala (ms) – ločuje dvakratno uro ob prehodu na zimski čas (25-urni dan). */
export type Point = { date: string; hour: number; wh: number; ts?: number };

const keyOf = (p: Point) => (p.ts !== undefined ? `t${p.ts}` : `${p.date}|${p.hour}`);

const UNIT_TO_WH: Record<string, number> = { WH: 1, KWH: 1000, MWH: 1_000_000 };

type RawSeries = { unit?: unknown; values?: unknown };

/**
 * Točke ene metrike. Če jo poroča več merilnikov, vzamemo tistega z največ meritvami
 * (seštevanje bi lahko podvojilo energijo, če si dva merilnika delita isti tok).
 * Vrne tudi serijsko številko izbranega merilnika.
 */
export function pickMetric(body: unknown, metric: string, container: "meters" | "inverters" = "meters"): { serial: string | null; points: Point[] } {
  const meters = (body as Record<string, Record<string, Record<string, RawSeries>>> | null)?.[container];
  if (!meters || typeof meters !== "object") return { serial: null, points: [] };

  let best: { serial: string; points: Point[] } | null = null;
  for (const [serial, data] of Object.entries(meters)) {
    const s = data?.[metric];
    if (!s || !Array.isArray(s.values)) continue;
    const mult = UNIT_TO_WH[String(s.unit ?? "WH").toUpperCase()] ?? 1;
    const points: Point[] = [];
    for (const v of s.values as Array<{ timestamp?: unknown; value?: unknown }>) {
      if (v?.value === null || v?.value === undefined || typeof v.timestamp !== "string") continue;
      const wh = Number(v.value) * mult;
      if (!Number.isFinite(wh) || wh < -1e12) continue; // npr. -3.4e38 = »ni vrednosti«
      const loc = localIntervalStart(v.timestamp, 60, "start");
      if (!loc) continue;
      points.push({ date: loc.date, hour: loc.hour, wh, ts: Date.parse(v.timestamp) });
    }
    if (points.length > 0 && (!best || points.length > best.points.length)) best = { serial, points };
  }
  return { serial: best?.serial ?? null, points: best?.points ?? [] };
}

/** Ploska serija { unit, values: [{ timestamp, value }] } – npr. odgovor /sites/{id}/energy (proizvodnja elektrarne). */
export function flatSeries(body: unknown): Point[] {
  const b = body as { unit?: unknown; values?: unknown } | null;
  if (!b || !Array.isArray(b.values)) return [];
  return pickMetric({ meters: { x: { v: { unit: b.unit, values: b.values } } } }, "v").points;
}

/** Vsota metrike čez vse naprave (inverterji: vsak daje svoj del proizvodnje). */
export function sumMetric(body: unknown, metric: string, container: "meters" | "inverters" = "inverters"): Point[] {
  const devs = (body as Record<string, Record<string, Record<string, RawSeries>>> | null)?.[container];
  if (!devs || typeof devs !== "object") return [];
  const acc = new Map<string, Point>();
  for (const serial of Object.keys(devs)) {
    const one = pickMetric({ [container]: { [serial]: devs[serial] } }, metric, container).points;
    for (const p of one) {
      const k = keyOf(p);
      const cur = acc.get(k);
      if (cur) cur.wh += p.wh;
      else acc.set(k, { ...p });
    }
  }
  return [...acc.values()];
}

/** Združi točke po (datum, ura) z linearno kombinacijo: a·A + b·B + c·C … (manjkajoče serije štejejo kot 0, rezultat ≥ 0). */
export function combine(terms: Array<{ k: number; points: Point[] }>, requireAll: number[] = [0]): Point[] {
  const keys = new Map<string, Point>();
  const vals = terms.map((t) => new Map(t.points.map((p) => [keyOf(p), p.wh])));
  terms.forEach((t) => t.points.forEach((p) => keys.set(keyOf(p), { date: p.date, hour: p.hour, wh: 0, ts: p.ts })));
  const out: Point[] = [];
  for (const [key, base] of keys) {
    if (!requireAll.every((i) => vals[i].has(key))) continue;
    let wh = 0;
    terms.forEach((t, i) => (wh += t.k * (vals[i].get(key) ?? 0)));
    out.push({ ...base, wh: Math.max(0, wh) });
  }
  return out;
}

/** DAY telemetrija → kWh po datumu (lokalni dan). */
export function dailyKwh(points: Point[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) out.set(p.date, (out.get(p.date) ?? 0) + p.wh / 1000);
  for (const [k, v] of out) out.set(k, Math.round(v * 1000) / 1000);
  return out;
}

const hh = (h: number) => String(h).padStart(2, "0");

/** Urne točke → kWh po blokih za vsak dan. */
export function pointsToBlocks(points: Point[]) {
  return hourlyWhToBlocks(points.map((p) => ({ date: `${p.date} ${hh(p.hour)}:00:00`, value: p.wh })));
}

/**
 * Urna samooskrba = poraba − uvoz (po uri, ne manj kot 0) – enaka logika kot »poraba − uvoz = samooskrba«.
 * Upošteva samo ure, za katere imamo oba podatka.
 */
export function hourlySelfConsumption(consumption: Point[], imported: Point[]): Point[] {
  const imp = new Map(imported.map((p) => [`${p.date}|${p.hour}`, p.wh]));
  const out: Point[] = [];
  for (const c of consumption) {
    const i = imp.get(`${c.date}|${c.hour}`);
    if (i === undefined) continue;
    out.push({ date: c.date, hour: c.hour, wh: Math.max(0, c.wh - i) });
  }
  return out;
}

/**
 * Proizvodnja, uvoz, izvoz, poraba in samooskrba iz odgovora merilnikov (+ inverterjev, če merilnik ne poroča proizvodnje).
 * Poraba = proizvodnja + uvoz − izvoz; samooskrba = proizvodnja − izvoz (SolarEdgeova definicija).
 */
export function deriveEnergy(meters: unknown, altProd: Point[] | null) {
  const mProd = pickMetric(meters, "productionEnergy").points;
  const prod: Point[] = mProd.length > 0 ? mProd : altProd ?? [];
  const imp = pickMetric(meters, "importEnergy").points;
  const exp = pickMetric(meters, "exportEnergy").points;
  const mCons = pickMetric(meters, "consumptionEnergy").points;
  const cons: Point[] =
    mCons.length > 0
      ? mCons
      : prod.length > 0 && imp.length > 0
        ? combine([{ k: 1, points: prod }, { k: 1, points: imp }, { k: -1, points: exp }], [1]) // proizvodnja/izvoz brez vrednosti (ponoči) = 0
        : [];
  const self: Point[] =
    prod.length > 0 && exp.length > 0
      ? combine([{ k: 1, points: prod }, { k: -1, points: exp }], [1])
      : cons.length > 0 && imp.length > 0
        ? combine([{ k: 1, points: cons }, { k: -1, points: imp }], [0, 1])
        : [];
  return { prod, imp, exp, cons, self, needInverters: mProd.length === 0 };
}

// ───────── lokalni čas (Europe/Ljubljana) → ISO z odmikom ─────────

/** Polnoč lokalnega dneva kot ISO z odmikom (npr. 2026-10-01T00:00:00+02:00) in kot ms. */
export function localMidnight(date: string): { iso: string; ms: number } {
  const [y, m, d] = date.split("-").map(Number);
  for (const off of [1, 2]) {
    const ms = Date.UTC(y, m - 1, d) - off * 3_600_000;
    const loc = localIntervalStart(new Date(ms).toISOString(), 60, "start");
    if (loc && loc.date === date && loc.hour === 0) {
      return { iso: `${date}T00:00:00+0${off}:00`, ms };
    }
  }
  const ms = Date.UTC(y, m - 1, d) - 3_600_000;
  return { iso: `${date}T00:00:00+01:00`, ms };
}

/**
 * Okna za urne klice enega dneva. API dovoli največ 24 h na klic, zato ima 25-urni dan (prehod na zimski čas)
 * še dodatno okno za zadnjo uro (`extra`).
 */
export function dayWindow(date: string): { from: string; to: string; extra?: { from: string; to: string } } {
  const a = localMidnight(date);
  const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1));
  const nd = `${next.getUTCFullYear()}-${hh(next.getUTCMonth() + 1)}-${hh(next.getUTCDate())}`;
  const b = localMidnight(nd);
  if (b.ms - a.ms <= 24 * 3_600_000) return { from: a.iso, to: b.iso };
  const cut = new Date(a.ms + 24 * 3_600_000).toISOString();
  return { from: a.iso, to: cut, extra: { from: cut, to: b.iso } };
}

/** Združi dva izračuna (npr. dve okni istega dne). */
export function mergeDerived(a: ReturnType<typeof deriveEnergy>, b: ReturnType<typeof deriveEnergy>) {
  return {
    prod: [...a.prod, ...b.prod], imp: [...a.imp, ...b.imp], exp: [...a.exp, ...b.exp],
    cons: [...a.cons, ...b.cons], self: [...a.self, ...b.self], needInverters: a.needInverters || b.needInverters,
  };
}
