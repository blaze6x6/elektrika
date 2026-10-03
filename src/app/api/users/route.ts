import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function GET() {
  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users);
  return NextResponse.json({ users: allUsers });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { username, password, isAdmin } = body;

  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    await db.insert(users).values({
      username,
      passwordHash: hash,
      isAdmin: isAdmin || false,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Uporabniško ime že obstaja" }, { status: 409 });
  }
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { id, password, isAdmin } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (password) {
    updates.passwordHash = await bcrypt.hash(password, 10);
  }
  if (isAdmin !== undefined) {
    updates.isAdmin = isAdmin;
  }

  await db.update(users).set(updates).where(eq(users.id, id));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db.delete(users).where(eq(users.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
