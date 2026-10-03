import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { eq, between, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { logAction } from "@/lib/audit";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // YYYY-MM
  const year = searchParams.get("year"); // YYYY (for yearly totals)

  if (year) {
    // Fetch all data for the year
    const startStr = `${year}-01-01`;
    const endStr = `${year}-12-31`;
    const data = await db
      .select()
      .from(dailyValues)
      .where(between(dailyValues.date, startStr, endStr));
    return NextResponse.json({ data });
  }

  if (!month) {
    return NextResponse.json({ error: "month or year param required" }, { status: 400 });
  }

  // Parse month to get date range
  // IMPORTANT: do NOT use toISOString() – it converts to UTC and can shift
  // the date by one day in timezones east of UTC (e.g. Europe/Ljubljana UTC+2).
  // Instead, build the YYYY-MM-DD string directly from local date parts.
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // last day of month

  const startStr = `${y}-${String(m).padStart(2, "0")}-01`;
  const endStr = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const data = await db
    .select()
    .from(dailyValues)
    .where(between(dailyValues.date, startStr, endStr));

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { date, columnKey, value } = body;

  if (!date || !columnKey) {
    return NextResponse.json({ error: "Missing date or columnKey" }, { status: 400 });
  }

  const numValue = parseFloat(value);
  const finalValue = isNaN(numValue) ? 0 : numValue;

  // Check if exists
  const [existing] = await db
    .select()
    .from(dailyValues)
    .where(and(eq(dailyValues.date, date), eq(dailyValues.columnKey, columnKey)));

  if (existing) {
    await db
      .update(dailyValues)
      .set({ value: finalValue, updatedAt: new Date() })
      .where(and(eq(dailyValues.date, date), eq(dailyValues.columnKey, columnKey)));
  } else {
    await db.insert(dailyValues).values({
      date,
      columnKey,
      value: finalValue,
      isManual: true,
    });
  }

  const session = await getSession().catch(() => null);
  await logAction(session?.username || "system", "edit", `${date} ${columnKey} = ${finalValue}`);

  return NextResponse.json({ success: true });
}
