import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// Open-Meteo free API – no key needed
export async function POST(request: Request) {
  const body = await request.json();
  const { month } = body;
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  // Default: Ljubljana coordinates
  const lat = process.env.WEATHER_LAT || "46.0569";
  const lon = process.env.WEATHER_LON || "14.5058";

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean&start_date=${startDate}&end_date=${endDate}&timezone=Europe/Ljubljana`;
    const res = await fetch(url);
    const json = await res.json();

    if (!json.daily?.time) {
      return NextResponse.json({ error: "Ni vremenskih podatkov" }, { status: 500 });
    }

    let saved = 0;
    for (let i = 0; i < json.daily.time.length; i++) {
      const dateStr = json.daily.time[i];
      const tempMax = json.daily.temperature_2m_max?.[i];
      const tempMin = json.daily.temperature_2m_min?.[i];
      const tempMean = json.daily.temperature_2m_mean?.[i];

      if (tempMean !== null && tempMean !== undefined) {
        // Save mean temp
        const [ex] = await db.select().from(dailyValues)
          .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temperatura")));
        if (ex) {
          await db.update(dailyValues).set({ value: tempMean, updatedAt: new Date() })
            .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temperatura")));
        } else {
          await db.insert(dailyValues).values({ date: dateStr, columnKey: "temperatura", value: tempMean, isManual: false });
        }

        // Save max temp
        if (tempMax !== null) {
          const [ex2] = await db.select().from(dailyValues)
            .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temp_max")));
          if (ex2) {
            await db.update(dailyValues).set({ value: tempMax, updatedAt: new Date() })
              .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temp_max")));
          } else {
            await db.insert(dailyValues).values({ date: dateStr, columnKey: "temp_max", value: tempMax, isManual: false });
          }
        }

        // Save min temp
        if (tempMin !== null) {
          const [ex3] = await db.select().from(dailyValues)
            .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temp_min")));
          if (ex3) {
            await db.update(dailyValues).set({ value: tempMin, updatedAt: new Date() })
              .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, "temp_min")));
          } else {
            await db.insert(dailyValues).values({ date: dateStr, columnKey: "temp_min", value: tempMin, isManual: false });
          }
        }

        saved++;
      }
    }

    return NextResponse.json({ success: true, saved });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Napaka" }, { status: 500 });
  }
}
