import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const sessionToken = request.cookies.get("session")?.value;
  const session = await verifySessionToken(sessionToken);
  const pathname = request.nextUrl.pathname;

  // Public paths - no auth needed
  const isPublic =
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icons/") ||
    pathname === "/api/health" ||
    pathname === "/login";

  if (isPublic) {
    return NextResponse.next();
  }

  // Cron requests authenticated via X-Cron-Secret header
  if (pathname === "/api/sync" || pathname === "/api/sync/mojelektro" || pathname === "/api/email/send" || pathname === "/api/weather" || pathname === "/api/solaredge/live") {
    const cronSecret = process.env.CRON_SECRET || "energy_cron_secret_123";
    const headerSecret = request.headers.get("x-cron-secret");
    if (headerSecret === cronSecret) {
      return NextResponse.next();
    }
  }

  // Not logged in? Redirect to login
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Logged in but on login page? Redirect to home
  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/).*)",
  ],
};
