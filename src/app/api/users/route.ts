import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { isValidUsername, parseId, validatePassword } from "@/lib/validate";

async function adminCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isAdmin, true));
  return r?.n ?? 0;
}

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.id);
  return NextResponse.json({ users: allUsers });
}

export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const { password } = body;

  if (!isValidUsername(username)) {
    return badRequest("Uporabniško ime: 3–64 znakov (črke, številke, . _ @ -)");
  }
  const pwProblem = validatePassword(password);
  if (pwProblem) return badRequest(pwProblem);

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .limit(1);
  if (dup) return NextResponse.json({ error: "Uporabniško ime že obstaja" }, { status: 409 });

  const hash = await bcrypt.hash(password as string, 12);
  await db.insert(users).values({
    username,
    passwordHash: hash,
    isAdmin: body.isAdmin === true,
    mustChangePassword: true, // uporabnik si ob prvi prijavi izbere svoje geslo
  });
  await logAction(g.user.username, "user_create", `${username}${body.isAdmin === true ? " (admin)" : ""}`);
  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const id = parseId(body.id);
  if (!id) return badRequest("id required");

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "Uporabnik ne obstaja" }, { status: 404 });

  const updates: Partial<typeof users.$inferInsert> = {};
  const changed: string[] = [];

  if (body.password !== undefined && body.password !== "") {
    const problem = validatePassword(body.password);
    if (problem) return badRequest(problem);
    updates.passwordHash = await bcrypt.hash(body.password as string, 12);
    updates.tokenVersion = (target.tokenVersion ?? 0) + 1; // razveljavi obstoječe seje
    updates.mustChangePassword = id !== g.user.id;
    changed.push("geslo");
  }
  if (body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean") return badRequest("isAdmin mora biti boolean");
    if (!body.isAdmin && target.isAdmin && (await adminCount()) <= 1) {
      return badRequest("Ni mogoče odvzeti pravic zadnjemu skrbniku.");
    }
    updates.isAdmin = body.isAdmin;
    changed.push(`admin=${body.isAdmin}`);
  }
  if (changed.length === 0) return badRequest("Ni sprememb");

  await db.update(users).set(updates).where(eq(users.id, id));
  await logAction(g.user.username, "user_update", `${target.username}: ${changed.join(", ")}`);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const id = parseId(new URL(request.url).searchParams.get("id"));
  if (!id) return badRequest("id required");
  if (id === g.user.id) return badRequest("Ne moreš izbrisati samega sebe.");

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "Uporabnik ne obstaja" }, { status: 404 });
  if (target.isAdmin && (await adminCount()) <= 1) {
    return badRequest("Ni mogoče izbrisati zadnjega skrbnika.");
  }

  await db.delete(users).where(eq(users.id, id));
  await logAction(g.user.username, "user_delete", target.username);
  return NextResponse.json({ success: true });
}
