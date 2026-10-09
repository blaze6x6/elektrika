"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { RateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http";
import { logAction } from "@/lib/audit";

// 10 napačnih poskusov na uporabnika / 15 min -> 5 min zaklep; 30 na IP -> 15 min
const userLimiter = new RateLimiter(10, 15 * 60_000, 5 * 60_000);
const ipLimiter = new RateLimiter(30, 15 * 60_000, 15 * 60_000);

let dummyHash: string | null = null;
function getDummyHash() {
  // primerjava z navideznim hashem izenači čas odziva za neobstoječe uporabnike
  if (!dummyHash) dummyHash = bcrypt.hashSync("neobstojec-uporabnik-" + Date.now(), 12);
  return dummyHash;
}

export async function login(formData: FormData) {
  const rawUser = formData.get("username");
  const rawPass = formData.get("password");
  const username = typeof rawUser === "string" ? rawUser.trim() : "";
  const password = typeof rawPass === "string" ? rawPass : "";

  if (!username || !password || username.length > 255 || password.length > 1000) {
    return { error: "Prosimo, vnesite uporabniško ime in geslo." };
  }

  const h = await headers();
  const ip = clientIp(h);
  const uKey = username.toLowerCase();

  const uCheck = userLimiter.check(uKey);
  const iCheck = ipLimiter.check(ip);
  if (!uCheck.allowed || !iCheck.allowed) {
    const wait = Math.max(uCheck.retryAfterSec, iCheck.retryAfterSec);
    return { error: `Preveč neuspešnih poskusov. Poskusite znova čez ${Math.ceil(wait / 60)} min.` };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${uKey}`)
    .limit(1);

  const valid = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
  if (!user || !valid) {
    userLimiter.fail(uKey);
    ipLimiter.fail(ip);
    await logAction(username.slice(0, 100), "login_failed", `ip=${ip}`);
    return { error: "Napačno uporabniško ime ali geslo." };
  }

  userLimiter.success(uKey);
  await createSession(user.id, user.username, user.tokenVersion ?? 0, !!user.mustChangePassword);
  await logAction(user.username, "login", `ip=${ip}`);
  redirect(user.mustChangePassword ? "/change-password" : "/");
}
