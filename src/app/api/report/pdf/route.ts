import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues, columnConfigs } from "@/db/schema";
import { between, asc } from "drizzle-orm";
import { evaluateFormula } from "@/lib/formula";

// Generate a simple HTML-based PDF-printable report
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startStr = `${month}-01`;
  const endStr = `${month}-${String(lastDay).padStart(2, "0")}`;

  const data = await db.select().from(dailyValues).where(between(dailyValues.date, startStr, endStr));
  const cols = await db.select().from(columnConfigs).orderBy(asc(columnConfigs.displayOrder));
  const visibleCols = cols.filter(c => c.visible);

  const lookup: Record<string, Record<string, number>> = {};
  data.forEach(r => { if (!lookup[r.date]) lookup[r.date] = {}; lookup[r.date][r.columnKey] = r.value ?? 0; });

  const getCellValue = (dateStr: string, col: typeof visibleCols[0]) => {
    const dayVals = lookup[dateStr] || {};
    if (col.sourceType === "formula" && col.formula) return evaluateFormula(col.formula, dayVals);
    return dayVals[col.key] ?? 0;
  };

  const MONTH_NAMES = ["Januar", "Februar", "Marec", "April", "Maj", "Junij", "Julij", "Avgust", "September", "Oktober", "November", "December"];
  const monthName = MONTH_NAMES[m - 1];
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");

  // Build rows
  let tableRows = "";
  const totals: Record<string, number> = {};
  visibleCols.forEach(c => (totals[c.key] = 0));

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${month}-${String(d).padStart(2, "0")}`;
    let row = `<tr><td style="padding:4px 8px;border:1px solid #ddd;text-align:center;font-weight:500">${d}.${m}.${y}</td>`;
    for (const col of visibleCols) {
      const val = getCellValue(dateStr, col);
      totals[col.key] += val;
      const color = val < 0 ? "color:#dc2626" : val > 0 ? "" : "color:#ccc";
      row += `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;${color}">${val !== 0 ? fmt(val) : ""}</td>`;
    }
    tableRows += row + "</tr>";
  }

  // Totals row
  let totalRow = '<tr style="background:#f0fdf4;font-weight:bold"><td style="padding:6px 8px;border:1px solid #ddd">SKUPAJ</td>';
  for (const col of visibleCols) {
    const v = totals[col.key];
    totalRow += `<td style="padding:6px 8px;border:1px solid #ddd;text-align:right;color:${v < 0 ? "#dc2626" : "#16a34a"}">${fmt(v)}</td>`;
  }
  totalRow += "</tr>";

  const headers = visibleCols.map(c => `<th style="padding:6px 8px;border:1px solid #ddd;background:#1f2937;color:white;text-align:center;font-size:11px">${c.label}<br><span style="font-weight:normal;font-size:9px;color:#9ca3af">(${c.unit})</span></th>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Poročilo ${monthName} ${y}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 14px; color: #666; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    tr:nth-child(even) { background: #f9fafb; }
    @media print { body { margin: 10px; } h1 { font-size: 18px; } }
    @page { size: landscape; margin: 10mm; }
  </style></head><body>
  <h1>⚡ Energijsko poročilo</h1>
  <h2>${monthName} ${y}</h2>
  <table>
    <thead><tr><th style="padding:6px 8px;border:1px solid #ddd;background:#1f2937;color:white">Datum</th>${headers}</tr></thead>
    <tbody>${tableRows}${totalRow}</tbody>
  </table>
  <p style="color:#999;font-size:10px;margin-top:16px;text-align:center">Generirano: ${new Date().toLocaleString("sl-SI")} · Štrom poraba</p>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
