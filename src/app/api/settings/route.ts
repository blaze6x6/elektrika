import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(appSettings);
  const settings: Record<string, string> = {};
  rows.forEach(r => { settings[r.key] = r.value || ""; });
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { key, value } = body;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (existing) {
    await db.update(appSettings).set({ value: String(value) }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value: String(value) });
  }
  return NextResponse.json({ success: true });
}
