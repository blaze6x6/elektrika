import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/guard";
import { loadMonth } from "@/lib/report-data";
import { daysInMonth, escapeHtml, isValidMonth } from "@/lib/validate";

const MONTH_NAMES = ["Januar", "Februar", "Marec", "April", "Maj", "Junij", "Julij", "Avgust", "September", "Oktober", "November", "December"];

// Tiskalno prijazno HTML poročilo. Vsa vsebina je escapana, skripta pa teče
// samo z nonce-om (CSP te poti je nastavljen ločeno od globalnega).
export async function GET(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const month = new URL(request.url).searchParams.get("month");
  if (!isValidMonth(month)) return NextResponse.json({ error: "month: pričakovano YYYY-MM" }, { status: 400 });

  const [y, m] = month.split("-").map(Number);
  const lastDay = daysInMonth(month);
  const { visibleCols, cell } = await loadMonth(month);

  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  const monthName = MONTH_NAMES[m - 1];

  let tableRows = "";
  const totals: Record<string, number> = {};
  visibleCols.forEach((c) => (totals[c.key] = 0));

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${month}-${String(d).padStart(2, "0")}`;
    let row = `<tr><td class="date">${d}.${m}.${y}</td>`;
    for (const col of visibleCols) {
      const val = cell(dateStr, col);
      totals[col.key] += val;
      const cls = val < 0 ? "neg" : val === 0 ? "zero" : "";
      row += `<td class="num ${cls}">${val !== 0 ? fmt(val) : ""}</td>`;
    }
    tableRows += row + "</tr>";
  }

  let totalRow = '<tr class="total"><td>SKUPAJ</td>';
  for (const col of visibleCols) {
    const v = totals[col.key];
    totalRow += `<td class="num ${v < 0 ? "neg" : "pos"}">${fmt(v)}</td>`;
  }
  totalRow += "</tr>";

  const headers = visibleCols
    .map((c) => `<th>${escapeHtml(c.label)}<br><span class="unit">(${escapeHtml(c.unit ?? "")})</span></th>`)
    .join("");

  const nonce = randomBytes(16).toString("base64");
  const html = `<!DOCTYPE html><html lang="sl"><head><meta charset="utf-8"><title>Poročilo ${escapeHtml(monthName)} ${y}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 14px; color: #666; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td { padding: 4px 8px; border: 1px solid #ddd; }
    th { background: #1f2937; color: #fff; text-align: center; font-size: 11px; }
    .unit { font-weight: normal; font-size: 9px; color: #9ca3af; }
    td.date { text-align: center; font-weight: 500; }
    td.num { text-align: right; }
    td.neg { color: #dc2626; } td.zero { color: #ccc; } td.pos { color: #16a34a; }
    tr:nth-child(even) { background: #f9fafb; }
    tr.total { background: #f0fdf4; font-weight: bold; }
    .foot { color: #999; font-size: 10px; margin-top: 16px; text-align: center; }
    @media print { body { margin: 10px; } h1 { font-size: 18px; } }
    @page { size: landscape; margin: 10mm; }
  </style></head><body>
  <h1>⚡ Energijsko poročilo</h1>
  <h2>${escapeHtml(monthName)} ${y}</h2>
  <table>
    <thead><tr><th>Datum</th>${headers}</tr></thead>
    <tbody>${tableRows}${totalRow}</tbody>
  </table>
  <p class="foot">Generirano: ${escapeHtml(new Date().toLocaleString("sl-SI"))} · Štrom poraba</p>
  <script nonce="${nonce}">window.addEventListener("load",function(){window.print()})</script>
  </body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
