import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { requireAdmin, requireUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { DEFAULT_TARIFF, sanitizeTariff } from "@/lib/tariff";
import { loadAllSettings } from "@/lib/settings";

export async function GET() {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const settings = await loadAllSettings();
  const tariff: Record<string, number> = {};
  for (const [key, defaultVal] of Object.entries(DEFAULT_TARIFF)) {
    const raw = settings[`tariff_${key}`];
    const n = raw !== undefined && raw !== "" ? parseFloat(raw) : NaN;
    tariff[key] = Number.isFinite(n) ? n : defaultVal;
  }
  return NextResponse.json({ tariff });
}

export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const res = sanitizeTariff(body.tariff);
  if (!res.ok) return badRequest(res.error);

  const rows = Object.entries(res.values).map(([k, v]) => ({ key: `tariff_${k}`, value: String(v) }));
  if (rows.length === 0) return badRequest("Ni vrednosti za shranjevanje");

  await db
    .insert(appSettings)
    .values(rows)
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value` } });
  await logAction(g.user.username, "tariff", `posodobljenih ${rows.length} vrednosti`);
  return NextResponse.json({ success: true });
}
