import { asc, between } from "drizzle-orm";
import { db } from "@/db";
import { columnConfigs, dailyValues } from "@/db/schema";
import { buildFormulaMap, evaluateFormula } from "@/lib/formula";
import { monthRange } from "@/lib/validate";

export type Col = typeof columnConfigs.$inferSelect;

export type PeriodData = {
  cols: Col[];
  visibleCols: Col[];
  lookup: Record<string, Record<string, number>>;
  formulaMap: Record<string, string>;
  cell: (dateStr: string, col: Col) => number;
};

/** Naloži stolpce in dnevne vrednosti za obdobje (YYYY-MM-DD, vključno). */
export async function loadPeriod(from: string, to: string): Promise<PeriodData> {
  const cols = await db.select().from(columnConfigs).orderBy(asc(columnConfigs.displayOrder));
  const data = await db.select().from(dailyValues).where(between(dailyValues.date, from, to));
  const lookup: Record<string, Record<string, number>> = {};
  for (const r of data) {
    (lookup[r.date] ||= {})[r.columnKey] = r.value ?? 0;
  }
  const formulaMap = buildFormulaMap(cols);
  const cell = (dateStr: string, col: Col): number => {
    const dayVals = lookup[dateStr] || {};
    if (col.sourceType === "formula" && col.formula) return evaluateFormula(col.formula, dayVals, formulaMap);
    return dayVals[col.key] ?? 0;
  };
  return { cols, visibleCols: cols.filter((c) => c.visible), lookup, formulaMap, cell };
}

export async function loadMonth(month: string): Promise<PeriodData> {
  const { start, end } = monthRange(month);
  return loadPeriod(start, end);
}

/** Vsota po vseh dnevih meseca za vsak vidni stolpec. */
export function monthTotals(p: PeriodData, month: string): Record<string, number> {
  const { start } = monthRange(month);
  const days = Number(monthRange(month).end.slice(8, 10));
  const totals: Record<string, number> = {};
  for (const col of p.visibleCols) {
    let t = 0;
    for (let d = 1; d <= days; d++) {
      t += p.cell(`${start.slice(0, 8)}${String(d).padStart(2, "0")}`, col);
    }
    totals[col.key] = t;
  }
  return totals;
}
