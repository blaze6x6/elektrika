"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth";
import { getCurrentUser } from "@/lib/guard";
import { validatePassword } from "@/lib/validate";
import { RateLimiter } from "@/lib/rate-limit";
import { logAction } from "@/lib/audit";

const limiter = new RateLimiter(5, 15 * 60_000, 15 * 60_000);

export async function changePassword(_prev: unknown, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const key = `pw:${user.id}`;
  const chk = limiter.check(key);
  if (!chk.allowed) return { error: `Preveč poskusov. Poskusite čez ${Math.ceil(chk.retryAfterSec / 60)} min.` };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next !== confirm) return { error: "Novi gesli se ne ujemata." };
  const problem = validatePassword(next);
  if (problem) return { error: problem };
  if (next === current) return { error: "Novo geslo mora biti drugačno od trenutnega." };

  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) {
    limiter.fail(key);
    return { error: "Trenutno geslo ni pravilno." };
  }

  const hash = await bcrypt.hash(next, 12);
  const [updated] = await db
    .update(users)
    .set({
      passwordHash: hash,
      mustChangePassword: false,
      tokenVersion: sql`${users.tokenVersion} + 1`, // odjavi vse druge seje
    })
    .where(eq(users.id, user.id))
    .returning({ tv: users.tokenVersion });

  limiter.success(key);
  await createSession(user.id, user.username, updated.tv, false);
  await logAction(user.username, "password_change", "lastno geslo");
  redirect("/");
}
