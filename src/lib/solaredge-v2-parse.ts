import { hourlyWhToBlocks, localIntervalStart } from "./blocks";

/**
 * Razčlenjevanje odgovora SolarEdge v2 »Meter Telemetry«
 * (GET /v2/sites/{id}/meters/telemetry, resolution=HOUR|DAY).
 *
 * Oblika: { meters: { "<serijska>": { productionEnergy: { unit: "WH", values: [{ timestamp, value }] }, … } } }
 * Časovni žig = ZAČETEK intervala. Čiste funkcije (brez baze in omrežja) → testi.
 */

export type Point = { date: string; hour: number; wh: number };

const UNIT_TO_WH: Record<string, number> = { WH: 1, KWH: 1000, MWH: 1_000_000 };

type RawSeries = { unit?: unknown; values?: unknown };

/**
 * Točke ene metrike. Če jo poroča več merilnikov, vzamemo tistega z največ meritvami
 * (seštevanje bi lahko podvojilo energijo, če si dva merilnika delita isti tok).
 * Vrne tudi serijsko številko izbranega merilnika.
 */
export function pickMetric(body: unknown, metric: string): { serial: string | null; points: Point[] } {
  const meters = (body as { meters?: Record<string, Record<string, RawSeries>> } | null)?.meters;
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
      if (!Number.isFinite(wh)) continue;
      const loc = localIntervalStart(v.timestamp, 60, "start");
      if (!loc) continue;
      points.push({ date: loc.date, hour: loc.hour, wh });
    }
    if (points.length > 0 && (!best || points.length > best.points.length)) best = { serial, points };
  }
  return { serial: best?.serial ?? null, points: best?.points ?? [] };
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

/** Okno za urni klic enega dneva (največ 24 h – omejitev API-ja; ob 25-urnem dnevu zadnja ura odpade). */
export function dayWindow(date: string): { from: string; to: string } {
  const a = localMidnight(date);
  const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1));
  const nd = `${next.getUTCFullYear()}-${hh(next.getUTCMonth() + 1)}-${hh(next.getUTCDate())}`;
  const b = localMidnight(nd);
  if (b.ms - a.ms <= 24 * 3_600_000) return { from: a.iso, to: b.iso };
  return { from: a.iso, to: new Date(a.ms + 24 * 3_600_000).toISOString() };
}
