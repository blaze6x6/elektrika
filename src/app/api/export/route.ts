import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues, columnConfigs } from "@/db/schema";
import { between, asc } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { evaluateFormula } from "@/lib/formula";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "Manjkata datuma od/do" }, { status: 400 });
  }

  // 1. Get all columns in order
  const columns = await db
    .select()
    .from(columnConfigs)
    .where(eq(columnConfigs.visible, true))
    .orderBy(asc(columnConfigs.displayOrder));

  // 2. Get all data for range
  const data = await db
    .select()
    .from(dailyValues)
    .where(between(dailyValues.date, from, to));

  // 3. Build lookup map
  const lookup: Record<string, Record<string, number>> = {};
  data.forEach((row) => {
    if (!lookup[row.date]) lookup[row.date] = {};
    lookup[row.date][row.columnKey] = row.value ?? 0;
  });

  // 4. Determine dates to include
  const start = parseISO(from);
  const end = parseISO(to);
  const dates: string[] = [];
  let curr = new Date(start);
  while (curr <= end) {
    dates.push(format(curr, "yyyy-MM-dd"));
    curr.setDate(curr.getDate() + 1);
  }

  // 5. Build CSV
  // Header: Datum; Stolpec1; Stolpec2...
  let csv = "Datum;" + columns.map(c => `${c.label} (${c.unit})`).join(";") + "\n";

  for (const dateStr of dates) {
    const dayVals = lookup[dateStr] || {};
    const rowCells = columns.map(col => {
      let val = 0;
      if (col.sourceType === "formula" && col.formula) {
        val = evaluateFormula(col.formula, dayVals);
      } else {
        val = dayVals[col.key] ?? 0;
      }
      // Format to Slovenian number: 12.5 -> "12,5"
      return val.toFixed(2).replace(".", ",");
    });
    
    // Format date to local: 2026-07-01 -> 01.07.2026
    const formattedDate = dateStr.split("-").reverse().join(".");
    csv += formattedDate + ";" + rowCells.join(";") + "\n";
  }

  // 6. Return as downloadable file
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="izvoz_energija_${from}_${to}.csv"`,
    },
  });
}

// Add eq import for step 1
import { eq } from "drizzle-orm";
