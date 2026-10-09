import { NextResponse } from "next/server";
import { db } from "@/db";
import { columnConfigs } from "@/db/schema";
import { requireUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { upsertDailyValues, type DailyInput } from "@/lib/sync-store";
import { isValidDate, parseLocaleNumber } from "@/lib/validate";
import Papa from "papaparse";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 20000;

/** DD.MM.YYYY, D.M.YYYY ali YYYY-MM-DD -> YYYY-MM-DD (ali null) */
function parseDate(raw: string): string | null {
  const dot = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const s = dot ? `${dot[3]}-${dot[2].padStart(2, "0")}-${dot[1].padStart(2, "0")}` : raw;
  return isValidDate(s) ? s : null;
}

export async function POST(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Neveljavna zahteva" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Datoteka ni bila naložena" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Datoteka je prevelika (največ 2 MB)" }, { status: 413 });

  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows || rows.length < 2) {
    return NextResponse.json({ error: "Datoteka je prazna ali napačnega formata" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Preveč vrstic (največ ${MAX_ROWS})` }, { status: 413 });
  }

  // Stolpci, ki jih je dovoljeno uvoziti: ročno urejljivi (ne formule)
  const cols = (await db.select().from(columnConfigs)).filter((c) => c.sourceType !== "formula" && c.editable !== false);
  const byName = new Map<string, string>();
  for (const c of cols) {
    byName.set(c.key.toLowerCase(), c.key);
    byName.set(c.label.trim().toLowerCase(), c.key);
  }

  // Glava: ključ ali oznaka stolpca; sprejmemo tudi izvozni zapis "Oznaka (kWh)"
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const colMap: Array<string | null> = header.map((h, i) => {
    if (i === 0) return null; // prvi stolpec je datum
    const stripped = h.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return byName.get(h) ?? byName.get(stripped) ?? null;
  });
  const unknownColumns = header.filter((h, i) => i > 0 && h && !colMap[i]);

  const inputs: DailyInput[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map((c) => String(c ?? "").trim());
    const rawDate = cells[0];
    if (!rawDate) continue;
    const lower = rawDate.toLowerCase();
    if (lower === "total" || lower === "skupaj" || lower.startsWith("povp")) continue;

    const dateStr = parseDate(rawDate);
    if (!dateStr) { skipped++; continue; }

    for (let c = 1; c < cells.length && c < colMap.length; c++) {
      const colKey = colMap[c];
      if (!colKey || cells[c] === "") continue;
      const val = parseLocaleNumber(cells[c]);
      if (val === null || Math.abs(val) > 1e9) { skipped++; continue; }
      inputs.push({ date: dateStr, columnKey: colKey, value: val });
    }
  }

  if (inputs.length === 0) {
    return NextResponse.json(
      { error: "V datoteki ni prepoznanih podatkov (preveri glavo in obliko datuma)", unknownColumns },
      { status: 400 }
    );
  }

  const res = await upsertDailyValues(inputs, { manual: true });
  await logAction(g.user.username, "import", `CSV uvoz: ${res.written} vrednosti, ${skipped + res.invalid} preskočenih`);
  return NextResponse.json({
    success: true,
    imported: res.written,
    skipped: skipped + res.invalid,
    unknownColumns,
  });
}
