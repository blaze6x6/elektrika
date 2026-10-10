import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pickSessionToken, verifySessionToken } from "@/lib/auth";
import { cronAuthorized } from "@/lib/secrets";

// Poti, ki jih sme poklicati cron s skrivnostjo (x-cron-secret).
// Route handlerji skrivnost preverijo še enkrat (defense in depth).
const CRON_PATHS = new Set(["/api/sync", "/api/sync/mojelektro", "/api/email/send"]);

const PUBLIC_EXACT = new Set(["/favicon.ico", "/manifest.json", "/sw.js", "/offline.html", "/api/health", "/login"]);

function isPublic(pathname: string) {
  return pathname.startsWith("/_next") || pathname.startsWith("/icons/") || PUBLIC_EXACT.has(pathname);
}

/** CSRF (poleg SameSite=Lax): zavrni spreminjajoče zahteve z drugega izvora. */
function crossOriginBlocked(request: NextRequest): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false; // curl/cron – brez piškotka seje ni nevarnosti
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const allowed = new Set<string>();
  const host = request.headers.get("host");
  const fwd = request.headers.get("x-forwarded-host");
  if (host) allowed.add(host);
  if (fwd) allowed.add(fwd.split(",")[0].trim());
  for (const o of (process.env.ALLOWED_ORIGINS || "").split(",")) {
    const t = o.trim();
    if (!t) continue;
    try { allowed.add(new URL(t).host); } catch { allowed.add(t); }
  }
  return !allowed.has(originHost);
}

function redirectTo(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");

  if (crossOriginBlocked(request)) {
    return NextResponse.json({ error: "Forbidden (origin)" }, { status: 403 });
  }

  const session = await verifySessionToken(pickSessionToken((n) => request.cookies.get(n)));

  if (pathname === "/login" && session) {
    return redirectTo(request, "/");
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Cron: skrivnost mora biti nastavljena, dovolj dolga in se ujemati
  if (CRON_PATHS.has(pathname) && cronAuthorized(request)) {
    return NextResponse.next();
  }

  if (!session) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return redirectTo(request, "/login");
  }

  // Prisilna zamenjava gesla (npr. začetno ali od skrbnika nastavljeno geslo)
  if (!isApi && session.mcp && pathname !== "/change-password") {
    return redirectTo(request, "/change-password");
  }

  const res = NextResponse.next();
  if (isApi) res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|icons/).*)"],
};
