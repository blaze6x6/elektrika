import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/guard";

export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const raw = Number(new URL(request.url).searchParams.get("limit") || 200);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 1000) : 200;
  const logs = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit);
  return NextResponse.json({ logs });
}
