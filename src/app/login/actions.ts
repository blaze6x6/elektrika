"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  if (!username || !password) {
    return { error: "Prosimo, vnesite uporabniško ime in geslo." };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user) {
    return { error: "Napačno uporabniško ime ali geslo." };
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return { error: "Napačno uporabniško ime ali geslo." };
  }

  await createSession(user.id, user.username);
  redirect("/");
}
