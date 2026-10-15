import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { localIntervalStart } from "@/lib/blocks";
import { v2Get, type V2Result } from "@/lib/solaredge-v2";
import { addDaysStr, monthRange } from "@/lib/validate";
import type { DailyInput } from "@/lib/sync-store";
import {
  dailyKwh, dayWindow, hourlySelfConsumption, localMidnight, pickMetric, pointsToBlocks,
} from "@/lib/solaredge-v2-parse";

export type V2Step = { results: string[]; rows: DailyInput[]; failed: boolean };

/** Največ urnih klicev (dni) na eno sinhronizacijo – 10 klicev/min in 2000 kreditov/mesec v brezplačnem paketu. */
const hourlyPerRun = () => {
  const n = Number(process.env.SOLAREDGE_V2_HOURLY_PER_RUN);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 8;
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
const dayCache = new Map<string, { at: number; body: unknown }>();
const CACHE_CURRENT_MS = 15 * 60_000;
const CACHE_PAST_MS = 6 * 3_600_000;

const todayLocal = () => localIntervalStart(new Date().toISOString(), 60, "start")!.date;

export async function syncSolarEdgeV2(month: string): Promise<V2Step> {
  const out: V2Step = { results: [], rows: [], failed: false };
  const { start, end } = monthRange(month);
  const today = todayLocal();

  try {
    // 1. Dnevni podatki za cel mesec – 1 klic (DAY: do 1 meseca)
    const from = localMidnight(start).iso;
    const to = localMidnight(addDaysStr(end, 1)).iso;
    let credits = 0;
    const ttl = month === today.slice(0, 7) ? CACHE_CURRENT_MS : CACHE_PAST_MS;
    const hit = dayCache.get(month);
    let dayBody: unknown;
    if (hit && Date.now() - hit.at < ttl) {
      dayBody = hit.body;
    } else {
      const dayRes = await v2Get("/meters/telemetry", { from, to, resolution: "DAY" });
      credits++;
      if (dayRes.status !== 200) {
        out.failed = true;
        out.results.push(`❌ SolarEdge v2 ${httpMessage("dnevni podatki", dayRes)} (porabljenih kreditov: ${credits})`);
        return out;
      }
      dayBody = dayRes.body;
      // praznega odgovora ne predpomnimo (da popravek takoj učinkuje)
      if (pickMetric(dayBody, "productionEnergy").points.length + pickMetric(dayBody, "consumptionEnergy").points.length > 0) {
        dayCache.set(month, { at: Date.now(), body: dayBody });
      }
    }

    const prod = dailyKwh(pickMetric(dayBody, "productionEnergy").points);
    const cons = dailyKwh(pickMetric(dayBody, "consumptionEnergy").points);
    for (const [date, v] of prod) out.rows.push({ date, columnKey: "solarna", value: v });
    for (const [date, v] of cons) out.rows.push({ date, columnKey: "skupna_poraba", value: v });
    if (prod.size === 0 && cons.size === 0) {
      // pomoč pri diagnozi: oblika odgovora (brez vrednosti)
      const b = dayBody as Record<string, unknown> | null;
      const m = (b?.meters ?? null) as unknown;
      const first = m && typeof m === "object" && !Array.isArray(m) ? Object.values(m as object)[0] : Array.isArray(m) ? m[0] : null;
      out.results.push(
        `🔎 Oblika odgovora: ključi=${b && typeof b === "object" ? Object.keys(b).join(",") : typeof b}; meters=${Array.isArray(m) ? "seznam" : m && typeof m === "object" ? Object.keys(m as object).length + " merilnikov" : "ni"}; prvi=${first && typeof first === "object" ? Object.keys(first as object).join(",") : "–"}; okno=${from} → ${to}`
      );
    }
    out.results.push(
      prod.size > 0 ? `✅ SolarEdge v2 proizvodnja: ${prod.size} dni` : "⚠️ SolarEdge v2 proizvodnja: ni podatkov (merilnik proizvodnje?)"
    );
    out.results.push(
      cons.size > 0 ? `✅ SolarEdge v2 skupna poraba: ${cons.size} dni` : "⚠️ SolarEdge v2 poraba: ni podatkov (potreben je merilnik porabe)"
    );

    // 2. Urni podatki → samooskrba in uvoz po blokih. En klic = en dan (največ 24 h), zato samo dnevi, ki jih še nimamo.
    const limit = hourlyPerRun();
    const active = new Set<string>();
    for (const m of [prod, cons]) for (const [d, v] of m) if (v > 0 && d <= today) active.add(d);

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
    const todo = [...active].filter((d) => d < today && !final.has(d)).sort().reverse();
    const batch = todo.slice(0, limit);

    let done = 0;
    let stop = "";
    for (const date of batch) {
      const w = dayWindow(date);
      const r = await v2Get("/meters/telemetry", { ...w, resolution: "HOUR" });
      credits++;
      if (r.status !== 200) {
        stop = httpMessage(`urni podatki ${date}`, r);
        break;
      }
      const c = pickMetric(r.body, "consumptionEnergy").points;
      const i = pickMetric(r.body, "importEnergy").points;
      if (c.length === 0 || i.length === 0) continue;
      const self = pointsToBlocks(hourlySelfConsumption(c, i)).get(date);
      const buy = pointsToBlocks(i).get(date);
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
      out.results.push("⚠️ SolarEdge v2 urni podatki: merilnik ne vrača porabe/uvoza po urah; kalkulator bo uporabil oceno.");
    }
  } catch (err) {
    out.failed = true;
    const msg = err instanceof Error ? err.message : "neznana napaka";
    console.error("[sync] SolarEdge v2:", msg);
    out.results.push(`❌ SolarEdge v2: ${msg}`);
  }
  return out;
}
