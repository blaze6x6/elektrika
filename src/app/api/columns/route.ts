import { NextResponse } from "next/server";
import { db } from "@/db";
import { columnConfigs } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  const columns = await db
    .select()
    .from(columnConfigs)
    .orderBy(asc(columnConfigs.displayOrder));
  return NextResponse.json({ columns });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { key, label, sourceType, formula, unit, editable, displayOrder } = body;

  if (!key || !label) {
    return NextResponse.json({ error: "key and label required" }, { status: 400 });
  }

  await db.insert(columnConfigs).values({
    key,
    label,
    sourceType: sourceType || "manual",
    formula: formula || null,
    unit: unit || "kWh",
    editable: editable !== false,
    displayOrder: displayOrder ?? 99,
  });

  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { id, label, sourceType, formula, unit, editable, displayOrder, visible } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (label !== undefined) updates.label = label;
  if (sourceType !== undefined) updates.sourceType = sourceType;
  if (formula !== undefined) updates.formula = formula;
  if (unit !== undefined) updates.unit = unit;
  if (editable !== undefined) updates.editable = editable;
  if (displayOrder !== undefined) updates.displayOrder = displayOrder;
  if (visible !== undefined) updates.visible = visible;

  await db.update(columnConfigs).set(updates).where(eq(columnConfigs.id, id));

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db.delete(columnConfigs).where(eq(columnConfigs.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
