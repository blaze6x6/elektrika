import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { connectionStatus, redirectUri } from "@/lib/solaredge-v2";

export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  return NextResponse.json({ ...(await connectionStatus()), redirectUri: redirectUri(request.headers) });
}
