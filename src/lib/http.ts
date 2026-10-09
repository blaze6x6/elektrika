import { NextResponse } from "next/server";

/** fetch s časovno omejitvijo, da zunanji API ne more obesiti zahteve. */
export function fetchT(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/** Skrije api_key v URL-jih pred beleženjem. */
export function redactUrl(url: string): string {
  return url.replace(/(api_key|apikey|token)=[^&]+/gi, "$1=***");
}

/** Varno prebere JSON telo (max ~1 MB); vrne null ob napaki. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > 1_000_000) return null;
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const badRequest = (error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status: 400 });

export function clientIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64) || "unknown";
  return (h.get("x-real-ip") || "unknown").slice(0, 64);
}
