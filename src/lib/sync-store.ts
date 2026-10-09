import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { isValidDate } from "@/lib/validate";

export type DailyInput = { date: string; columnKey: string; value: number };

/**
 * Množičen upsert dnevnih vrednosti v eni transakciji (brez race conditionov).
 *
 * - manual=true  (ročni vnos / CSV uvoz): vedno prepiše in označi isManual=true.
 * - manual=false (sinhronizacija): NE prepiše ročno vnesenih vrednosti,
 *   razen če je force=true.
 *
 * Vrne število zapisanih in preskočenih (zaščitenih) vrednosti.
 */
export async function upsertDailyValues(
  input: DailyInput[],
  opts: { manual: boolean; force?: boolean }
): Promise<{ written: number; skipped: number; invalid: number }> {
  const dedup = new Map<string, DailyInput>();
  let invalid = 0;
  for (const r of input) {
    if (!isValidDate(r.date) || !Number.isFinite(r.value)) {
      invalid++;
      continue;
    }
    dedup.set(`${r.date}|${r.columnKey}`, r); // zadnja vrednost zmaga
  }
  const rows = [...dedup.values()];
  if (rows.length === 0) return { written: 0, skipped: 0, invalid };

  const protectManual = !opts.manual && !opts.force;
  let written = 0;

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({
        date: r.date,
        columnKey: r.columnKey,
        value: r.value,
        isManual: opts.manual,
      }));
      const res = await tx
        .insert(dailyValues)
        .values(chunk)
        .onConflictDoUpdate({
          target: [dailyValues.date, dailyValues.columnKey],
          set: { value: sql`excluded.value`, isManual: opts.manual, updatedAt: new Date() },
          ...(protectManual ? { setWhere: eq(dailyValues.isManual, false) } : {}),
        })
        .returning({ id: dailyValues.id });
      written += res.length;
    }
  });

  return { written, skipped: rows.length - written, invalid };
}
