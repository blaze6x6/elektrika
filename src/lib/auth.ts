import { JWTPayload, SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { getJwtSecret } from "./secrets";

export type SessionPayload = JWTPayload & {
  userId: number;
  username: string;
  /** token_version uporabnika – povišanje razveljavi vse obstoječe seje */
  tv: number;
  /** mora zamenjati geslo (hitri preklop v proxy-ju; resnica je v bazi) */
  mcp?: boolean;
};

export const COOKIE_PLAIN = "session";
export const COOKIE_HOST = "__Host-session"; // uporabljen, ko je piškotek Secure

const parsedDays = Number.parseInt(process.env.SESSION_DAYS || "180", 10);
const sessionDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 180;
const sessionMaxAge = sessionDays * 24 * 60 * 60;

let keyCache: Uint8Array | null = null;
function key(): Uint8Array {
  if (!keyCache) keyCache = new TextEncoder().encode(getJwtSecret());
  return keyCache;
}

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionDays} days from now`)
    .sign(key());
}

export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key(), { algorithms: ["HS256"] });
  return payload as SessionPayload;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) return null;
  try {
    const p = await decrypt(token);
    if (typeof p.userId !== "number" || typeof p.tv !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

/** Prebere žeton iz katerega koli od obeh imen piškotka. */
export function pickSessionToken(get: (name: string) => { value: string } | undefined): string | undefined {
  return get(COOKIE_HOST)?.value ?? get(COOKIE_PLAIN)?.value;
}

export async function getSession() {
  const cookieStore = await cookies();
  return verifySessionToken(pickSessionToken((n) => cookieStore.get(n)));
}

/**
 * Secure piškotek: COOKIE_SECURE=true/false ima prednost, sicer se zazna
 * iz X-Forwarded-Proto (reverse proxy z HTTPS).
 */
async function isSecure(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  try {
    const h = await headers();
    return (h.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
  } catch {
    return false;
  }
}

export async function createSession(userId: number, username: string, tv: number, mustChange = false) {
  const token = await encrypt({ userId, username, tv, mcp: mustChange || undefined });
  const secure = await isSecure();
  const cookieStore = await cookies();
  // odstrani piškotek z drugim imenom, da ne ostane star
  cookieStore.set(secure ? COOKIE_PLAIN : COOKIE_HOST, "", { path: "/", maxAge: 0 });
  cookieStore.set(secure ? COOKIE_HOST : COOKIE_PLAIN, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAge,
    priority: "high",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_PLAIN, "", { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 0 });
  cookieStore.set(COOKIE_HOST, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
