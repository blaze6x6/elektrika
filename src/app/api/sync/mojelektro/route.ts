import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { fetchMonthBlockData, fetchMerilnoMesto, fetchMerilnaTocka, fetchReadingTypes, fetchReadingQualities } from "@/lib/mojelektro";

async function saveValue(dateStr: string, columnKey: string, value: number) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.warn(`Preskakujem neveljaven datum: "${dateStr}" za stolpec ${columnKey}`);
    return;
  }
  const [existing] = await db
    .select().from(dailyValues)
    .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, columnKey)));
  if (existing) {
    await db.update(dailyValues)
      .set({ value, isManual: false, updatedAt: new Date() })
      .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, columnKey)));
  } else {
    await db.insert(dailyValues).values({ date: dateStr, columnKey, value, isManual: false });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { month } = body;

  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const token = process.env.MOJELEKTRO_API_KEY;
  const usagePoint = process.env.MOJELEKTRO_EIMM; // EIMM identifikator

  const results: string[] = [];

  if (!token || !usagePoint) {
    return NextResponse.json({
      success: false,
      results: ["❌ MojElektro: Nastavi MOJELEKTRO_API_KEY in MOJELEKTRO_EIMM v .env"]
    });
  }

  try {
    // Pridobi podatke po blokih za cel mesec
    const blockData = await fetchMonthBlockData(token, usagePoint, month);

    if (blockData.size === 0) {
      results.push("⚠️ MojElektro: Ni podatkov za ta mesec (podatki so dosegljivi z ~24h zamikom)");
    } else {
      let savedDays = 0;
      for (const [dateStr, day] of blockData) {
        await saveValue(dateStr, "me_blok1", day.blok1);
        await saveValue(dateStr, "me_blok2", day.blok2);
        await saveValue(dateStr, "me_blok3", day.blok3);
        await saveValue(dateStr, "me_blok4", day.blok4);
        await saveValue(dateStr, "me_blok5", day.blok5);
        await saveValue(dateStr, "me_uvoz", day.uvoz);
        await saveValue(dateStr, "me_oddaja", day.oddaja);
        savedDays++;
      }
      results.push(`✅ MojElektro: Shranjenih ${savedDays} dni (bloki + oddaja)`);
    }

    // Samodejno posodobi dogovorjene moči iz API-ja v nastavitve
    if (process.env.MOJELEKTRO_GSRN_MT) {
      const mtData = await fetchMerilnaTocka(token, process.env.MOJELEKTRO_GSRN_MT);
      const { extractContractedPower } = await import("@/lib/mojelektro");
      const powers = extractContractedPower(mtData);
      if (powers) {
        const { appSettings } = await import("@/db/schema");
        for (const [k, v] of Object.entries(powers)) {
          await db.insert(appSettings).values({ key: `tariff_${k}`, value: String(v) })
            .onConflictDoUpdate({ target: appSettings.key, set: { value: String(v) } });
        }
        results.push("✅ MojElektro: Posodobljene dogovorjene moči (Bloki 1-5)");
      }
    }

  } catch (err) {
    results.push(`❌ MojElektro: ${err instanceof Error ? err.message : "Napaka"}`);
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  const token = process.env.MOJELEKTRO_API_KEY;
  const usagePoint = process.env.MOJELEKTRO_EIMM;
  const gsrnMt = process.env.MOJELEKTRO_GSRN_MT;

  if (!token || !usagePoint) {
    return NextResponse.json({ error: "API ključ ni nastavljen" }, { status: 400 });
  }

  if (type === "merilno-mesto") {
    const data = await fetchMerilnoMesto(token, usagePoint);
    return NextResponse.json({ data });
  }

  if (type === "merilna-tocka") {
    if (!gsrnMt) {
      return NextResponse.json({ error: "Nastavi MOJELEKTRO_GSRN_MT v .env" }, { status: 400 });
    }
    const data = await fetchMerilnaTocka(token, gsrnMt);
    return NextResponse.json({ data });
  }

  if (type === "reading-type") {
    const data = await fetchReadingTypes(token);
    return NextResponse.json({ data });
  }

  if (type === "reading-qualities") {
    const data = await fetchReadingQualities(token);
    return NextResponse.json({ data });
  }

  return NextResponse.json({ error: "type parameter required (merilno-mesto | merilna-tocka | reading-type | reading-qualities)" }, { status: 400 });
}
