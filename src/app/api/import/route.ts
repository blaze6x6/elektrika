import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import Papa from "papaparse";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File;
  if (!file) return NextResponse.json({ error: "Datoteka ni bila naložena" }, { status: 400 });

  const text = await file.text();
  const { data: rows } = Papa.parse(text, { header: false, skipEmptyLines: true });

  // Detect separator and format
  // Expected: date ; col1 ; col2 ; ...  OR  date , col1 , col2, ...
  // First row = header with column keys or labels
  if (!rows || rows.length < 2) {
    return NextResponse.json({ error: "Datoteka je prazna ali napačnega formata" }, { status: 400 });
  }

  const header = (rows[0] as string[]).map(h => h.trim().toLowerCase());
  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = (rows[i] as string[]).map(c => c.trim());
    const rawDate = cells[0];
    if (!rawDate || rawDate.toLowerCase() === "total" || rawDate.toLowerCase() === "skupaj" || rawDate.toLowerCase().startsWith("povp")) continue;

    // Parse date: try DD.MM.YYYY, YYYY-MM-DD, D.M.YYYY
    let dateStr = "";
    const dotMatch = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotMatch) {
      dateStr = `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      dateStr = rawDate;
    }
    if (!dateStr) { skipped++; continue; }

    for (let c = 1; c < cells.length && c < header.length; c++) {
      const colKey = header[c];
      if (!colKey || colKey === "datum" || colKey === "date") continue;
      const val = parseFloat(cells[c].replace(",", "."));
      if (isNaN(val)) continue;

      const [existing] = await db.select().from(dailyValues)
        .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, colKey)));
      if (existing) {
        await db.update(dailyValues).set({ value: val, updatedAt: new Date() })
          .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, colKey)));
      } else {
        await db.insert(dailyValues).values({ date: dateStr, columnKey: colKey, value: val, isManual: true });
      }
      imported++;
    }
  }

  await logAction(session.username, "import", `CSV uvoz: ${imported} vrednosti, ${skipped} preskočenih`);
  return NextResponse.json({ success: true, imported, skipped });
}
