import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { cronAuthorized } from "@/lib/secrets";

export type AuthUser = {
  id: number;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

/** Preveri sejo glede na bazo: uporabnik obstaja in token_version se ujema. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const s = await getSession();
  if (!s) return null;
  const [u] = await db
    .select({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
      tokenVersion: users.tokenVersion,
      mustChange: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, s.userId))
    .limit(1);
  if (!u) return null;
  if ((u.tokenVersion ?? 0) !== s.tv) return null;
  return { id: u.id, username: u.username, isAdmin: !!u.isAdmin, mustChangePassword: !!u.mustChange };
}

export type Guard = { ok: true; user: AuthUser } | { ok: false; res: NextResponse };

const deny = (status: number, error: string, code?: string): Guard => ({
  ok: false,
  res: NextResponse.json({ error, ...(code ? { code } : {}) }, { status }),
});

export async function requireUser(opts: { allowMustChange?: boolean } = {}): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return deny(401, "Unauthorized");
  if (user.mustChangePassword && !opts.allowMustChange) {
    return deny(403, "Najprej zamenjaj geslo.", "PASSWORD_CHANGE_REQUIRED");
  }
  return { ok: true, user };
}

export async function requireAdmin(): Promise<Guard> {
  const g = await requireUser();
  if (!g.ok) return g;
  if (!g.user.isAdmin) return deny(403, "Forbidden: potrebne so skrbniške pravice.");
  return g;
}

/** Dovoli cron (x-cron-secret) ali prijavljenega uporabnika. */
export async function requireCronOrUser(
  request: Request
): Promise<{ ok: true; actor: string } | { ok: false; res: NextResponse }> {
  if (cronAuthorized(request)) return { ok: true, actor: "cron" };
  const g = await requireUser();
  if (!g.ok) return g;
  return { ok: true, actor: g.user.username };
}

/** Za strežniške strani (server components). */
export async function requirePageUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  return user;
}

export async function requirePageAdmin(): Promise<AuthUser> {
  const user = await requirePageUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
