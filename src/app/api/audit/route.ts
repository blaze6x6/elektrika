import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const logs = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);
  return NextResponse.json({ logs });
}
