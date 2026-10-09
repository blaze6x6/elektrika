import { NextResponse } from "next/server";
import { db } from "@/db";
import { columnConfigs, dailyValues } from "@/db/schema";
import { eq, between } from "drizzle-orm";
import { requireUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { COLUMN_KEY_RE, isValidDate, isValidMonth, isValidYear, monthRange, toFiniteNumber } from "@/lib/validate";
import { upsertDailyValues } from "@/lib/sync-store";

export async function GET(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // YYYY-MM
  const year = searchParams.get("year"); // YYYY

  if (year) {
    if (!isValidYear(year)) return badRequest("year: pričakovano YYYY");
    const data = await db
      .select()
      .from(dailyValues)
      .where(between(dailyValues.date, `${year}-01-01`, `${year}-12-31`));
    return NextResponse.json({ data });
  }

  if (!month) return badRequest("month or year param required");
  if (!isValidMonth(month)) return badRequest("month: pričakovano YYYY-MM");

  // Niz YYYY-MM-DD gradimo ročno (brez toISOString) – izognemo se UTC zamiku.
  const { start, end } = monthRange(month);
  const data = await db.select().from(dailyValues).where(between(dailyValues.date, start, end));
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const { date, columnKey } = body;

  if (!isValidDate(date)) return badRequest("date: pričakovano veljavno YYYY-MM-DD");
  if (typeof columnKey !== "string" || !COLUMN_KEY_RE.test(columnKey)) return badRequest("columnKey: neveljaven");

  const rawValue = body.value;
  const value = rawValue === "" || rawValue === null || rawValue === undefined ? 0 : toFiniteNumber(rawValue);
  if (value === null) return badRequest("value: pričakovano končno število");

  const [col] = await db.select().from(columnConfigs).where(eq(columnConfigs.key, columnKey)).limit(1);
  if (!col) return NextResponse.json({ error: "Stolpec ne obstaja" }, { status: 404 });
  if (col.sourceType === "formula" || col.editable === false) {
    return NextResponse.json({ error: "Ta stolpec ni ročno urejljiv" }, { status: 403 });
  }

  // ročni vnos je označen isManual=true, zato ga sinhronizacija ne prepiše
  await upsertDailyValues([{ date, columnKey, value }], { manual: true });
  await logAction(g.user.username, "edit", `${date} ${columnKey} = ${value}`);
  return NextResponse.json({ success: true });
}
