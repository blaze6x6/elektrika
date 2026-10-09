import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireAdmin, requireCronOrUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { isValidMonth } from "@/lib/validate";
import { upsertDailyValues, type DailyInput } from "@/lib/sync-store";
import { Cooldown } from "@/lib/rate-limit";
import {
  extractContractedPower,
  fetchMerilnaTocka,
  fetchMerilnoMesto,
  fetchMonthBlockData,
  fetchReadingQualities,
  fetchReadingTypes,
} from "@/lib/mojelektro";

const cooldown = new Cooldown(30_000);

export async function POST(request: Request) {
  const auth = await requireCronOrUser(request);
  if (!auth.ok) return auth.res;

  const body = await readJson(request);
  const month = body?.month;
  if (!isValidMonth(month)) return badRequest("month (YYYY-MM) required");
  const force = body?.force === true;

  const token = process.env.MOJELEKTRO_API_KEY;
  const usagePoint = process.env.MOJELEKTRO_EIMM; // EIMM identifikator
  if (!token || !usagePoint) {
    return NextResponse.json({
      success: true,
      results: ["ℹ️ MojElektro: ni nastavljen (MOJELEKTRO_API_KEY in MOJELEKTRO_EIMM v .env)"],
    });
  }

  if (auth.actor !== "cron") {
    const wait = cooldown.hit(`me:${month}`);
    if (wait > 0) {
      return NextResponse.json(
        { success: false, results: [`⚠️ MojElektro sinhronizacija je bila pravkar zagnana. Poskusi znova čez ${wait} s.`] },
        { status: 429 }
      );
    }
  }

  const results: string[] = [];
  let failed = false;

  try {
    const stamp = process.env.MOJELEKTRO_TS_MODE === "start" ? "start" : "end";
    const res = await fetchMonthBlockData(token, usagePoint, month, stamp);
    const blockData = res.days;
    if (blockData.size === 0) {
      results.push(
        `⚠️ MojElektro: ni podatkov za ta mesec (odčitkov: ${res.readings}). Podatki so dosegljivi z zamikom enega ali več dni.`
      );
    } else {
      const rows: DailyInput[] = [];
      for (const [dateStr, day] of blockData) {
        rows.push(
          { date: dateStr, columnKey: "me_blok1", value: day.blok1 },
          { date: dateStr, columnKey: "me_blok2", value: day.blok2 },
          { date: dateStr, columnKey: "me_blok3", value: day.blok3 },
          { date: dateStr, columnKey: "me_blok4", value: day.blok4 },
          { date: dateStr, columnKey: "me_blok5", value: day.blok5 },
          { date: dateStr, columnKey: "me_uvoz", value: day.uvoz },
          { date: dateStr, columnKey: "me_oddaja", value: day.oddaja }
        );
      }
      const saved = await upsertDailyValues(rows, { manual: false, force });
      const dates = [...blockData.keys()].sort();
      results.push(`✅ MojElektro: shranjenih ${blockData.size} dni (bloki iz 15-min odčitkov + oddaja)`);
      results.push(
        `ℹ️ MojElektro: ${res.readings} odčitkov, ${dates[0]} … ${dates[dates.length - 1]} (žig = ${stamp === "end" ? "konec" : "začetek"} intervala, endTime=${res.endTimeUsed})`
      );
      if (saved.skipped > 0) results.push(`ℹ️ Preskočenih ${saved.skipped} ročno vnesenih vrednosti.`);
    }

    // Samodejno posodobi dogovorjene moči iz API-ja v nastavitve (samo veljavne vrednosti)
    const gsrn = process.env.MOJELEKTRO_GSRN_MT;
    if (gsrn) {
      const powers = extractContractedPower(await fetchMerilnaTocka(token, gsrn));
      if (powers) {
        const rows = Object.entries(powers).map(([k, v]) => ({ key: `tariff_${k}`, value: String(v) }));
        await db
          .insert(appSettings)
          .values(rows)
          .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value` } });
        results.push(`✅ MojElektro: Posodobljene dogovorjene moči (${Object.keys(powers).length} blokov)`);
      }
    }
  } catch (err) {
    failed = true;
    const msg = err instanceof Error ? err.message : "Napaka";
    console.error("[sync/mojelektro]", msg);
    results.push(`❌ MojElektro: ${msg}`);
  }

  await logAction(auth.actor, "sync_mojelektro", `${month}${failed ? " (napaka)" : ""}`);
  return NextResponse.json({ success: !failed, results }, { status: failed ? 502 : 200 });
}

/** Diagnostika (samo skrbnik). */
export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const type = new URL(request.url).searchParams.get("type");
  const token = process.env.MOJELEKTRO_API_KEY;
  const usagePoint = process.env.MOJELEKTRO_EIMM;
  const gsrnMt = process.env.MOJELEKTRO_GSRN_MT;

  if (!token || !usagePoint) {
    return NextResponse.json({ error: "API ključ ni nastavljen" }, { status: 400 });
  }

  try {
    if (type === "merilno-mesto") return NextResponse.json({ data: await fetchMerilnoMesto(token, usagePoint) });
    if (type === "merilna-tocka") {
      if (!gsrnMt) return NextResponse.json({ error: "Nastavi MOJELEKTRO_GSRN_MT v .env" }, { status: 400 });
      return NextResponse.json({ data: await fetchMerilnaTocka(token, gsrnMt) });
    }
    if (type === "reading-type") return NextResponse.json({ data: await fetchReadingTypes(token) });
    if (type === "reading-qualities") return NextResponse.json({ data: await fetchReadingQualities(token) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Napaka" }, { status: 502 });
  }

  return badRequest("type parameter required (merilno-mesto | merilna-tocka | reading-type | reading-qualities)");
}
