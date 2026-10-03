import { JWTPayload, SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type SessionPayload = JWTPayload & {
  userId: number;
  username: string;
};

const secretKey = process.env.JWT_SECRET || "default_secret_key_please_change_this_in_production";
const key = new TextEncoder().encode(secretKey);
const sessionDays = Number.parseInt(process.env.SESSION_DAYS || "180", 10);
const sessionMaxAge = Math.max(1, sessionDays) * 24 * 60 * 60;

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionDays} days from now`)
    .sign(key);
}

export async function decrypt(input: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });

  return payload as SessionPayload;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) {
    return null;
  }

  try {
    return await decrypt(token);
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  return verifySessionToken(token);
}

// Only set secure:true if actually behind HTTPS
function isSecure(): boolean {
  // If user explicitly sets COOKIE_SECURE=false, respect it
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  // Otherwise, only secure if NODE_ENV=production AND not plain HTTP
  // For most self-hosted Docker setups without HTTPS, this should be false
  return false;
}

export async function createSession(userId: number, username: string) {
  const session = await encrypt({ userId, username });
  const cookieStore = await cookies();
  cookieStore.set("session", session, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAge,
    expires: new Date(Date.now() + sessionMaxAge * 1000),
    priority: "high",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set("session", "", {
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
