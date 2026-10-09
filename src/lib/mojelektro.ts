/**
 * Mojelektro.si API integracija
 * Dokumentacija: https://docs.informatika.si/mojelektro/api/
 */

import { fetchT } from "@/lib/http";
import { aggregateMeIntervals, type MeDay, type MeIntervalBlock } from "@/lib/blocks";

const BASE_URL = "https://api.informatika.si/mojelektro/v1";

// ReadingType kode (iz /reading-type): 15-minutne količine, kWh.
// Bloke izračunamo sami iz teh odčitkov (API ne vrača odčitkov po blokih).
export const READING_TYPE_15MIN_IMPORT = "32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0"; // A+ prejeta
export const READING_TYPE_15MIN_EXPORT = "32.0.2.4.19.2.12.0.0.0.0.0.0.0.0.3.72.0"; // A- oddana

type IntervalReading = Record<string, unknown>;
type IntervalBlock = {
  readingType: string;
  intervalReadings: IntervalReading[];
};

/** GET z žetonom, časovno omejitvijo in smiselno napako ob neuspehu. */
async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetchT(url, { headers: { accept: "application/json", "X-API-TOKEN": token } }, 20000);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MojElektro HTTP ${res.status}${body ? ": " + body.substring(0, 200) : ""}`);
  }
  return res.json();
}

/**
 * Pridobi 15-minutne meritve za določeno obdobje
 */
export async function fetchMeterReadings(
  token: string,
  usagePoint: string,
  startTime: string,
  endTime: string,
  options: string[] = []
): Promise<IntervalBlock[] | null> {
  const params = new URLSearchParams({
    usagePoint,
    startTime,
    endTime,
  });

  for (const opt of options) {
    params.append("option", opt);
  }

  const url = `${BASE_URL}/meter-readings?${params.toString()}`;

  const data = await getJson(url, token);
  return (data as { intervalBlocks?: IntervalBlock[] }).intervalBlocks ?? null;
}

export type DayBlockDataExtended = MeDay;

export type MonthBlockResult = {
  days: Map<string, MeDay>;
  readings: number;       // število odčitkov, ki jih je vrnil API (za diagnostiko)
  firstTs?: string;
  lastTs?: string;
  endTimeUsed: string;
};

/**
 * Pridobi 15-minutne odčitke A+ in A- za mesec in jih združi po dnevih/blokih.
 * `stamp`: ali časovni žig pomeni začetek ali konec 15-min intervala (MOJELEKTRO_TS_MODE).
 */
export async function fetchMonthBlockData(
  token: string,
  usagePoint: string,
  month: string, // YYYY-MM
  stamp: "start" | "end" = "end"
): Promise<MonthBlockResult> {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startTime = `${month}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDayStr = `${month}-${String(lastDay).padStart(2, "0")}`;
  const options = [`ReadingType=${READING_TYPE_15MIN_IMPORT}`, `ReadingType=${READING_TYPE_15MIN_EXPORT}`];

  // Ne vemo, ali je endTime vključen: najprej prvi dan naslednjega meseca (da dobimo celoten zadnji dan),
  // ob napaki API-ja še zadnji dan meseca.
  let blocks: IntervalBlock[] | null = null;
  let endTimeUsed = nextMonth;
  try {
    blocks = await fetchMeterReadings(token, usagePoint, startTime, nextMonth, options);
  } catch {
    endTimeUsed = lastDayStr;
    blocks = await fetchMeterReadings(token, usagePoint, startTime, lastDayStr, options);
  }

  const all = aggregateMeIntervals((blocks ?? []) as MeIntervalBlock[], READING_TYPE_15MIN_IMPORT, READING_TYPE_15MIN_EXPORT, stamp);
  const days = new Map([...all].filter(([date]) => date.startsWith(month)));

  let readings = 0;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  for (const b of blocks ?? []) {
    for (const r of b.intervalReadings ?? []) {
      readings++;
      const ts = String(r.timestamp ?? r.d ?? r.date ?? "");
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
    }
  }
  return { days, readings, firstTs, lastTs, endTimeUsed };
}

/**
 * Parsira odgovor merilne točke in vrne aktualne dogovorjene moči
 */
type ContractedPowerEntry = {
  veljavnost?: boolean;
  datumOd?: string;
  datumVnosa?: string;
  casovniBlok1?: string | number;
  casovniBlok2?: string | number;
  casovniBlok3?: string | number;
  casovniBlok4?: string | number;
  casovniBlok5?: string | number;
};

export function extractContractedPower(data: unknown): Record<string, number> | null {
  const list = (data as { dogovorjeneMoci?: unknown } | null)?.dogovorjeneMoci;
  if (!Array.isArray(list)) return null;

  // Zadnji veljaven vnos (veljavnost: true)
  const active = (list as ContractedPowerEntry[])
    .filter((i) => i && i.veljavnost === true)
    .sort(
      (a, b) =>
        new Date(b.datumOd ?? 0).getTime() - new Date(a.datumOd ?? 0).getTime() ||
        new Date(b.datumVnosa ?? 0).getTime() - new Date(a.datumVnosa ?? 0).getTime()
    )[0];
  if (!active) return null;

  // Neveljavnih/manjkajočih vrednosti NE zapisujemo kot 0 (sicer bi prepisale pravo moč).
  const out: Record<string, number> = {};
  const raw = [active.casovniBlok1, active.casovniBlok2, active.casovniBlok3, active.casovniBlok4, active.casovniBlok5];
  raw.forEach((v, i) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    if (Number.isFinite(n) && n > 0) out[`moc_blok${i + 1}`] = n;
  });
  return Object.keys(out).length ? out : null;
}

/** Diagnostični klici – ob napaki vržejo izjemo z HTTP statusom. */
export async function fetchMerilnoMesto(token: string, identifikator: string): Promise<unknown> {
  return getJson(`${BASE_URL}/merilno-mesto/${encodeURIComponent(identifikator)}`, token);
}

export async function fetchMerilnaTocka(token: string, gsrn: string): Promise<unknown> {
  return getJson(`${BASE_URL}/merilna-tocka/${encodeURIComponent(gsrn)}`, token);
}

export async function fetchReadingTypes(token: string): Promise<unknown> {
  return getJson(`${BASE_URL}/reading-type`, token);
}

export async function fetchReadingQualities(token: string): Promise<unknown> {
  return getJson(`${BASE_URL}/reading-qualities`, token);
}
