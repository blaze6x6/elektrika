import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { disconnect } from "@/lib/solaredge-v2";

export async function POST() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  await disconnect();
  await logAction(g.user.username, "solaredge_disconnect");
  return NextResponse.json({ ok: true });
}
