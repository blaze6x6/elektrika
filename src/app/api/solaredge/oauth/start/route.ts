import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { SE_AUTHORIZE_URL, newState, oauthConfig, redirectUri } from "@/lib/solaredge-v2";

/** Začne povezavo s SolarEdge (OAuth): preusmeri na SolarEdge Connect. Samo skrbnik. */
export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const cfg = oauthConfig();
  if (!cfg) {
    return NextResponse.json({ error: "SOLAREDGE_CLIENT_ID in SOLAREDGE_CLIENT_SECRET morata biti nastavljena v .env." }, { status: 400 });
  }
  const state = newState();
  // state/external_id: dokumentaciji se razlikujeta, zato oba; access_duration=24 → 24-mesečna odobritev (največ)
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    scope: "SITE_DATA DEVICE_DATA",
    redirect_uri: redirectUri(request.headers),
    state,
    external_id: state,
    access_duration: "24",
  });
  const url = `${SE_AUTHORIZE_URL}?${q.toString()}`;
  const res = NextResponse.redirect(url);
  const secure = (request.headers.get("x-forwarded-proto") || "").startsWith("https") || new URL(request.url).protocol === "https:";
  res.cookies.set("se_oauth_state", state, { httpOnly: true, sameSite: "lax", secure, path: "/api/solaredge/oauth", maxAge: 600 });
  return res;
}
