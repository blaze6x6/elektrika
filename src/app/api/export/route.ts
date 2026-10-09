import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { loadPeriod } from "@/lib/report-data";
import { addDaysStr, csvCell, daysBetweenInclusive, isValidDate, safeFilenamePart } from "@/lib/validate";

const MAX_DAYS = 3660;

export async function GET(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!isValidDate(from) || !isValidDate(to)) {
    return NextResponse.json({ error: "Manjkata ali sta neveljavna datuma od/do (YYYY-MM-DD)" }, { status: 400 });
  }
  if (from > to) return NextResponse.json({ error: "Datum 'od' mora biti pred 'do'" }, { status: 400 });
  const nDays = daysBetweenInclusive(from, to);
  if (nDays > MAX_DAYS) {
    return NextResponse.json({ error: `Obdobje je predolgo (največ ${MAX_DAYS} dni)` }, { status: 400 });
  }

  const { visibleCols, cell } = await loadPeriod(from, to);

  const lines: string[] = [];
  lines.push(["Datum", ...visibleCols.map((c) => csvCell(`${c.label} (${c.unit ?? ""})`))].join(";"));

  for (let i = 0; i < nDays; i++) {
    const dateStr = addDaysStr(from, i);
    const cells = visibleCols.map((col) => cell(dateStr, col).toFixed(2).replace(".", ","));
    lines.push([dateStr.split("-").reverse().join("."), ...cells].join(";"));
  }

  // BOM, da Excel pravilno prikaže č, š, ž
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="izvoz_energija_${safeFilenamePart(from)}_${safeFilenamePart(to)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
