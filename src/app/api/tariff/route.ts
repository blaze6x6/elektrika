import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { requireAdmin, requireUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { resolveTariff, sanitizeTariff, tariffKey, tariffYears } from "@/lib/tariff";
import { loadAllSettings } from "@/lib/settings";

/** GET ?year=YYYY (privzeto tekoče leto) → { tariff, year, source, years } */
export async function GET(request: Request) {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const y = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
  const settings = await loadAllSettings();
  const { values, source } = resolveTariff(settings, year);
  return NextResponse.json({ tariff: values, year, source, years: tariffYears(settings) });
}

export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return badRequest("year: pričakovano leto (2000–2100)");
  const res = sanitizeTariff(body.tariff);
  if (!res.ok) return badRequest(res.error);

  const rows = Object.entries(res.values).map(([k, v]) => ({ key: tariffKey(year, k), value: String(v) }));
  if (rows.length === 0) return badRequest("Ni vrednosti za shranjevanje");

  await db
    .insert(appSettings)
    .values(rows)
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value` } });
  await logAction(g.user.username, "tariff", `leto ${year}: posodobljenih ${rows.length} vrednosti`);
  return NextResponse.json({ success: true });
}
