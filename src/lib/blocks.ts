/**
 * Časovni bloki omrežnine (Akt o metodologiji za obračunavanje omrežnine, Priloga 2).
 *
 * Sezone:  višja = november–februar, nižja = marec–oktober.
 * Dan:     delovni dan / dela prost dan (sobota, nedelja, državni prazniki – privzeta predpostavka).
 * Ura:     veljavni lokalni (zakonski) čas, 0–23.
 *
 * | ure          | višja, delovni | nižja, delovni | višja, dela prost | nižja, dela prost |
 * | 0–5          | 3              | 4              | 4                 | 5                 |
 * | 6            | 2              | 3              | 3                 | 4                 |
 * | 7–13         | 1              | 2              | 2                 | 3                 |
 * | 14–15        | 2              | 3              | 3                 | 4                 |
 * | 16–19        | 1              | 2              | 2                 | 3                 |
 * | 20–21        | 2              | 3              | 3                 | 4                 |
 * | 22–23        | 3              | 4              | 4                 | 5                 |
 */

export type Block = 1 | 2 | 3 | 4 | 5;

/** Datum "yyyy-MM-dd" → [leto, mesec(1–12), dan]. */
function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

export function isHighSeasonMonth(month: number): boolean {
  return month === 11 || month === 12 || month === 1 || month === 2;
}

/** Velikonočna nedelja (Gaussov algoritem) → [mesec, dan]. */
function easterSunday(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const FIXED_HOLIDAYS = new Set([
  "1-1", "1-2", "2-8", "4-27", "5-1", "5-2", "6-25", "8-15", "10-31", "11-1", "12-25", "12-26",
]);

/** Dela prost dan po zakonu (fiksni prazniki + velikonočni ponedeljek; nedelje pokrije dayOfWeek). */
export function isPublicHoliday(date: string): boolean {
  const [y, m, d] = parts(date);
  if (FIXED_HOLIDAYS.has(`${m}-${d}`)) return true;
  const [em, ed] = easterSunday(y);
  const easterMon = new Date(Date.UTC(y, em - 1, ed + 1));
  return easterMon.getUTCMonth() + 1 === m && easterMon.getUTCDate() === d;
}

/** 0 = nedelja … 6 = sobota */
export function dayOfWeek(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isNonWorkingDay(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6 || isPublicHoliday(date);
}

/** Blok za dano uro (0–23) na dani dan. */
export function blockForHour(date: string, hour: number): Block {
  const [, m] = parts(date);
  const high = isHighSeasonMonth(m);
  const off = isNonWorkingDay(date);
  // 3 = zelo nizka obremenitev, 2 = nizka, 1 = visoka (višja stopnja)
  let level: 0 | 1 | 2; // 0 = konica, 1 = vmesni, 2 = nočni
  if (hour <= 5 || hour >= 22) level = 2;
  else if (hour === 6 || (hour >= 14 && hour <= 15) || hour === 20 || hour === 21) level = 1;
  else level = 0;
  // pomik: višja sezona + delovni dan = začetek pri bloku 1
  const base = (high ? 1 : 2) + (off ? 1 : 0);
  return (base + level) as Block;
}

/** Bloki, ki se v danem mesecu sploh pojavijo (višja: 1–4, nižja: 2–5). */
export function activeBlocksForMonth(month: number): Block[] {
  return isHighSeasonMonth(month) ? [1, 2, 3, 4] : [2, 3, 4, 5];
}

/** Bloki, ki so na dani dan mogoči. */
export function blocksOccurringOn(date: string): Block[] {
  const set = new Set<Block>();
  for (let h = 0; h < 24; h++) set.add(blockForHour(date, h));
  return [...set].sort() as Block[];
}

// ───────── Ocena razporeda sončne proizvodnje po blokih ─────────

const LAT = 46.05, LON = 14.5; // Slovenija (približno)

function lastSunday(year: number, monthIdx: number): number {
  const last = new Date(Date.UTC(year, monthIdx + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** Poletni čas (CEST) – približno, na ravni dneva. */
export function isSummerTime(date: string): boolean {
  const [y, m, d] = parts(date);
  if (m < 3 || m > 10) return false;
  if (m > 3 && m < 10) return true;
  if (m === 3) return d >= lastSunday(y, 2);
  return d < lastSunday(y, 9);
}

function dayOfYear(date: string): number {
  const [y, m, d] = parts(date);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
}

/**
 * Delež dnevne sončne proizvodnje po urah (24 vrednosti, vsota 1) po modelu jasnega neba:
 * polovični sinus med sončnim vzhodom in zahodom, na lokalni (zakonski) čas.
 */
export function solarHourlyShares(date: string): number[] {
  const n = dayOfYear(date);
  const rad = Math.PI / 180;
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const cosW = -Math.tan(LAT * rad) * Math.tan(decl);
  const half = cosW >= 1 ? 0 : cosW <= -1 ? 12 : Math.acos(cosW) / rad / 15; // pol dolžine dneva (ure)
  const B = (2 * Math.PI * (n - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minute
  const tz = isSummerTime(date) ? 2 : 1;
  const noon = 12 + (15 * tz - LON) / 15 - eot / 60;

  const out = new Array<number>(24).fill(0);
  if (half <= 0) return out;
  const STEPS = 12;
  for (let h = 0; h < 24; h++) {
    for (let s = 0; s < STEPS; s++) {
      const t = h + (s + 0.5) / STEPS;
      const x = Math.abs(t - noon);
      if (x < half) out[h] += Math.cos((Math.PI / 2) * (x / half)) / STEPS;
    }
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map(v => v / sum) : out;
}

/** Delež sončne proizvodnje, ki pade v posamezen blok (indeks 0 = blok 1 … 4 = blok 5). */
export function solarBlockShares(date: string): [number, number, number, number, number] {
  const hourly = solarHourlyShares(date);
  const shares: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (let h = 0; h < 24; h++) shares[blockForHour(date, h) - 1] += hourly[h];
  return shares;
}

// ───────── Dejanska samooskrba po blokih iz urnih meritev (SolarEdge) ─────────

export type HourlyValue = { date: string; value: number | null };

/**
 * Urne vrednosti (datum "yyyy-MM-dd HH:mm:ss" = začetek intervala, vrednost v Wh)
 * seštejemo po dnevih v bloke. Vrne kWh po blokih [blok1..blok5] za vsak dan z vsaj eno meritvijo.
 * Opomba: bloki se menjajo ob polnih urah, zato urna ločljivost zadošča (15-min podatki dajo enak rezultat).
 */
export function hourlyWhToBlocks(values: HourlyValue[]): Map<string, [number, number, number, number, number]> {
  const out = new Map<string, [number, number, number, number, number]>();
  for (const v of values) {
    if (v.value === null || v.value === undefined || !Number.isFinite(v.value)) continue;
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):/.exec(v.date);
    if (!m) continue;
    const hour = Number(m[2]);
    if (hour < 0 || hour > 23) continue;
    const day = out.get(m[1]) ?? [0, 0, 0, 0, 0];
    day[blockForHour(m[1], hour) - 1] += v.value / 1000;
    out.set(m[1], day);
  }
  for (const d of out.values()) for (let i = 0; i < 5; i++) d[i] = Math.round(d[i] * 1000) / 1000;
  return out;
}

// ───────── MojElektro: 15-minutni odčitki → bloki ─────────

export type MeReading = { timestamp?: unknown; d?: unknown; date?: unknown; value?: unknown; v?: unknown };
export type MeIntervalBlock = { readingType?: string; intervalReadings?: MeReading[] };
export type MeDay = {
  date: string;
  blok1: number; blok2: number; blok3: number; blok4: number; blok5: number;
  uvoz: number;   // A+ skupaj
  oddaja: number; // A- skupaj
};

const TZ = "Europe/Ljubljana";
const HAS_OFFSET = /([zZ]|[+-]\d{2}:?\d{2})$/;

/** Lokalni (zakonski) datum in ura začetka intervala. `end` = časovni žig pomeni konec intervala. */
export function localIntervalStart(ts: string, intervalMin: number, stamp: "start" | "end"): { date: string; hour: number } | null {
  const shift = stamp === "end" ? intervalMin * 60_000 : 0;
  if (HAS_OFFSET.test(ts)) {
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    }).formatToParts(new Date(t - shift));
    const g = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(ts);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - shift;
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, hour: d.getUTCHours() };
}

/**
 * Združi 15-min odčitke A+ (uvoz) in A- (oddaja) po dnevih; uvoz razporedi v bloke 1–5 po uradnem urniku.
 * @param importType  readingType za A+ (15 min)
 * @param exportType  readingType za A- (15 min)
 */
export function aggregateMeIntervals(
  blocks: MeIntervalBlock[],
  importType: string,
  exportType: string,
  stamp: "start" | "end" = "end"
): Map<string, MeDay> {
  const out = new Map<string, MeDay>();
  for (const b of blocks) {
    const isImport = b.readingType === importType;
    if (!isImport && b.readingType !== exportType) continue;
    for (const r of b.intervalReadings ?? []) {
      const ts = String(r.timestamp ?? r.d ?? r.date ?? "");
      const val = parseFloat(String(r.value ?? r.v ?? ""));
      if (!ts || !Number.isFinite(val)) continue;
      const loc = localIntervalStart(ts, 15, stamp);
      if (!loc) continue;
      let day = out.get(loc.date);
      if (!day) {
        day = { date: loc.date, blok1: 0, blok2: 0, blok3: 0, blok4: 0, blok5: 0, uvoz: 0, oddaja: 0 };
        out.set(loc.date, day);
      }
      if (isImport) {
        const key = `blok${blockForHour(loc.date, loc.hour)}` as "blok1" | "blok2" | "blok3" | "blok4" | "blok5";
        day[key] += val;
        day.uvoz += val;
      } else {
        day.oddaja += val;
      }
    }
  }
  for (const d of out.values()) {
    for (const k of ["blok1", "blok2", "blok3", "blok4", "blok5", "uvoz", "oddaja"] as const) d[k] = Math.round(d[k] * 1000) / 1000;
  }
  return out;
}
