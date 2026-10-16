import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { localIntervalStart } from "@/lib/blocks";
import { v2Get, type V2Result } from "@/lib/solaredge-v2";
import { addDaysStr, monthRange } from "@/lib/validate";
import type { DailyInput } from "@/lib/sync-store";
import {
  dailyKwh, dayWindow, deriveEnergy, flatSeries, localMidnight, pointsToBlocks, sumMetric, type Point,
} from "@/lib/solaredge-v2-parse";

export type V2Step = { results: string[]; rows: DailyInput[]; failed: boolean };

/** Največ urnih klicev (dni) na eno sinhronizacijo – 10 klicev/min in 2000 kreditov/mesec v brezplačnem paketu. */
const hourlyPerRun = () => {
  const n = Number(process.env.SOLAREDGE_V2_HOURLY_PER_RUN);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
};

/** 429: x-ratelimit-remaining-minute = 0 → omejitev na minuto; > 0 → porabljeni mesečni krediti. */
function limitMessage(r: V2Result): string {
  const rem = r.rate["x-ratelimit-remaining-minute"];
  if (rem !== undefined && Number(rem) > 0) {
    return "porabljena je mesečna kvota kreditov (ponastavi se z novim obračunskim obdobjem)";
  }
  const wait = r.rate["retry-after"];
  return `omejitev klicev na minuto${wait ? ` (počakaj ${wait} s)` : ""} – poskusi čez minuto`;
}

function httpMessage(what: string, r: V2Result): string {
  if (r.status === 429) return `${what}: ${limitMessage(r)}`;
  const detail = typeof r.body === "object" && r.body ? (r.body as { detail?: unknown; message?: unknown }).detail ?? (r.body as { message?: unknown }).message : "";
  return `${what}: HTTP ${r.status}${detail ? ` – ${String(detail).slice(0, 160)}` : ""}`;
}

/** Dnevni odgovor predpomnimo: SolarEdge osvežuje podatke na 15 min, pretekli meseci se ne spreminjajo. */
const dayCache = new Map<string, { at: number; d: ReturnType<typeof deriveEnergy> }>();
const CACHE_CURRENT_MS = 15 * 60_000;
const CACHE_PAST_MS = 6 * 3_600_000;

const todayLocal = () => localIntervalStart(new Date().toISOString(), 60, "start")!.date;

export async function syncSolarEdgeV2(month: string): Promise<V2Step> {
  const out: V2Step = { results: [], rows: [], failed: false };
  const { start, end } = monthRange(month);
  const today = todayLocal();

  try {
    let credits = 0;

    /** Merilniki (uvoz/izvoz …) in po potrebi inverterji (proizvodnja) za eno okno. */
    const fetchPair = async (params: Record<string, string>, what: string) => {
      const m = await v2Get("/meters/telemetry", params);
      credits++;
      if (m.status !== 200) return { err: httpMessage(`${what} (merilniki)`, m) };
      let alt: Point[] | null = null;
      if (deriveEnergy(m.body, null).needInverters) {
        // proizvodnja: najprej /energy (izračunana PV proizvodnja elektrarne, enako kot v1), rezerva: vsota inverterjev
        const e = await v2Get("/energy", params);
        credits++;
        alt = e.status === 200 ? flatSeries(e.body) : [];
        if (alt.length === 0) {
          const i = await v2Get("/inverters/telemetry", params);
          credits++;
          if (i.status !== 200) {
            const hint = i.status === 403 ? " – potrebno je dovoljenje DEVICE_DATA: odklopi in znova poveži SolarEdge" : "";
            return { err: httpMessage(`${what} (proizvodnja)`, e.status === 200 ? i : e) + hint };
          }
          alt = sumMetric(i.body, "energy", "inverters");
        }
      }
      return { d: deriveEnergy(m.body, alt) };
    };

    // 1. Dnevni podatki za cel mesec (DAY: do 1 meseca)
    const from = localMidnight(start).iso;
    const to = localMidnight(addDaysStr(end, 1)).iso;
    const ttl = month === today.slice(0, 7) ? CACHE_CURRENT_MS : CACHE_PAST_MS;
    let d: ReturnType<typeof deriveEnergy>;
    const hit = dayCache.get(month);
    if (hit && Date.now() - hit.at < ttl) {
      d = hit.d;
    } else {
      const r = await fetchPair({ from, to, resolution: "DAY" }, "dnevni podatki");
      if ("err" in r) {
        out.failed = true;
        out.results.push(`❌ SolarEdge v2 ${r.err} (porabljenih kreditov: ${credits})`);
        return out;
      }
      d = r.d;
      // praznega odgovora ne predpomnimo (da popravek takoj učinkuje)
      if (d.prod.length + d.cons.length > 0) dayCache.set(month, { at: Date.now(), d });
    }

    const prod = dailyKwh(d.prod);
    const cons = dailyKwh(d.cons);
    for (const [date, v] of prod) out.rows.push({ date, columnKey: "solarna", value: v });
    for (const [date, v] of cons) out.rows.push({ date, columnKey: "skupna_poraba", value: v });
    out.results.push(
      prod.size > 0 ? `✅ SolarEdge v2 proizvodnja: ${prod.size} dni` : "⚠️ SolarEdge v2 proizvodnja: ni podatkov (niti merilnik niti inverterji ne poročajo energije)"
    );
    out.results.push(
      cons.size > 0
        ? `✅ SolarEdge v2 skupna poraba (proizvodnja + uvoz − izvoz): ${cons.size} dni`
        : "⚠️ SolarEdge v2 poraba: ni podatkov (potrebna sta proizvodnja in uvoz)"
    );

    // 2. Urni podatki → samooskrba in uvoz po blokih. En dan = 1–2 klica (največ 24 h na klic), zato samo dnevi, ki jih še nimamo.
    const limit = hourlyPerRun();
    const active = new Set<string>();
    for (const m of [prod, cons]) for (const [dt, v] of m) if (v > 0 && dt <= today) active.add(dt);

    // »Dokončan« dan = urni podatki so bili preneseni šele po koncu tistega dne → se ne spremenijo več.
    const final = new Set(
      (
        await db
          .select({ date: dailyValues.date, at: dailyValues.updatedAt })
          .from(dailyValues)
          .where(and(eq(dailyValues.columnKey, "se_samo_blok1"), gte(dailyValues.date, start), lte(dailyValues.date, end)))
      )
        .filter((r) => (localIntervalStart(new Date(r.at).toISOString(), 60, "start")?.date ?? "") > String(r.date))
        .map((r) => String(r.date))
    );
    // današnjega dne ne prenašamo po urah (nepopoln); dnevni seštevek za danes pride že iz dnevnega klica
    const todo = [...active].filter((x) => x < today && !final.has(x)).sort().reverse();
    const batch = todo.slice(0, limit);

    let done = 0;
    let stop = "";
    for (const date of batch) {
      const r = await fetchPair({ ...dayWindow(date), resolution: "HOUR" }, `urni podatki ${date}`);
      if ("err" in r) {
        stop = r.err;
        break;
      }
      const self = pointsToBlocks(r.d.self).get(date);
      const buy = pointsToBlocks(r.d.imp).get(date);
      if (!self || !buy) continue;
      self.forEach((kwh, k) => out.rows.push({ date, columnKey: `se_samo_blok${k + 1}`, value: kwh }));
      buy.forEach((kwh, k) => out.rows.push({ date, columnKey: `se_kup_blok${k + 1}`, value: kwh }));
      done++;
    }

    out.results.push(`ℹ️ SolarEdge v2: porabljenih kreditov: ${credits}${credits === 0 ? " (vse iz predpomnilnika)" : ""}`);
    if (done > 0) out.results.push(`✅ SolarEdge v2 samooskrba in uvoz po blokih: ${done} dni`);
    if (stop) out.results.push(`⚠️ SolarEdge v2 ${stop}`);
    const left = todo.length - batch.length;
    if (left > 0) {
      out.results.push(`ℹ️ SolarEdge v2: za ${left} dni urni podatki še niso preneseni (največ ${limit} dni na sinhronizacijo) – ponovi sinhronizacijo.`);
    }
    if (batch.length > 0 && done === 0 && !stop) {
      out.results.push("⚠️ SolarEdge v2 urni podatki: ni urnih vrednosti za samooskrbo/uvoz; kalkulator bo uporabil oceno.");
    }
  } catch (err) {
    out.failed = true;
    const msg = err instanceof Error ? err.message : "neznana napaka";
    console.error("[sync] SolarEdge v2:", msg);
    out.results.push(`❌ SolarEdge v2: ${msg}`);
  }
  return out;
}
