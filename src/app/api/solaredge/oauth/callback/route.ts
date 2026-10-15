import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireAdmin } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { connectWithCode, redirectUri } from "@/lib/solaredge-v2";

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function back(request: Request, query: string) {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000").split(",")[0].trim();
  const proto = (request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  const res = NextResponse.redirect(`${proto}://${host}/admin/solaredge?${query}`);
  res.cookies.set("se_oauth_state", "", { path: "/api/solaredge/oauth", maxAge: 0 });
  return res;
}

/** Povratni klic iz SolarEdge Connect: ?code=…&site_id=…&external_id=<state>. */
export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const siteId = (url.searchParams.get("site_id") || "").replace(/\D/g, "");
  const state = url.searchParams.get("external_id") || url.searchParams.get("state") || "";
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith("se_oauth_state="))?.split("=")[1] || "";

  if (!code || !siteId) return back(request, "status=error&msg=" + encodeURIComponent("Manjka koda ali ID elektrarne (avtorizacija ni bila odobrena)."));
  if (!state || !cookie || !safeEq(state, cookie)) {
    return back(request, "status=error&msg=" + encodeURIComponent("Neveljavno stanje seje (state). Poskusi znova od začetka."));
  }
  try {
    await connectWithCode(code, siteId, redirectUri(request.headers));
    await logAction(g.user.username, "solaredge_connect", `site ${siteId}`);
    return back(request, "status=connected");
  } catch (e) {
    return back(request, "status=error&msg=" + encodeURIComponent(e instanceof Error ? e.message : "Napaka"));
  }
}
