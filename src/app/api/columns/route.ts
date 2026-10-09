import { NextResponse } from "next/server";
import { db } from "@/db";
import { columnConfigs } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAdmin, requireUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { buildFormulaMap, extractFormulaKeys, validateFormula } from "@/lib/formula";
import { COLUMN_KEY_RE, SOURCE_TYPES, cleanString, parseId } from "@/lib/validate";

export async function GET() {
  const g = await requireUser();
  if (!g.ok) return g.res;
  const columns = await db.select().from(columnConfigs).orderBy(asc(columnConfigs.displayOrder));
  return NextResponse.json({ columns });
}

type SourceType = (typeof SOURCE_TYPES)[number];
const isSourceType = (v: unknown): v is SourceType => SOURCE_TYPES.includes(v as SourceType);

export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");

  const key = typeof body.key === "string" ? body.key.trim() : "";
  const label = cleanString(body.label, 255);
  if (!COLUMN_KEY_RE.test(key)) return badRequest("key: samo a–z, 0–9 in _ (največ 100 znakov)");
  if (!label) return badRequest("label je obvezen (največ 255 znakov)");

  const sourceType = body.sourceType === undefined ? "manual" : body.sourceType;
  if (!isSourceType(sourceType)) return badRequest(`sourceType: ${SOURCE_TYPES.join(" | ")}`);
  const unit = body.unit === undefined ? "kWh" : cleanString(body.unit, 50);
  if (!unit) return badRequest("unit: neveljavna enota");
  const displayOrder = Number.isInteger(body.displayOrder) ? (body.displayOrder as number) : 99;

  const all = await db.select().from(columnConfigs);
  if (all.some((c) => c.key === key)) {
    return NextResponse.json({ error: "Stolpec s tem ključem že obstaja" }, { status: 409 });
  }

  let formula: string | null = null;
  if (sourceType === "formula") {
    formula = typeof body.formula === "string" ? body.formula.trim() : "";
    const err = validateFormula(formula, {
      knownKeys: all.map((c) => c.key),
      ownKey: key,
      formulaMap: buildFormulaMap(all),
    });
    if (err) return badRequest(`Formula: ${err}`);
  }

  await db.insert(columnConfigs).values({
    key,
    label,
    sourceType,
    formula,
    unit,
    editable: sourceType === "formula" ? false : body.editable !== false,
    displayOrder,
  });
  await logAction(g.user.username, "column_create", `${key} (${sourceType})`);
  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");
  const id = parseId(body.id);
  if (!id) return badRequest("id required");

  const all = await db.select().from(columnConfigs);
  const current = all.find((c) => c.id === id);
  if (!current) return NextResponse.json({ error: "Stolpec ne obstaja" }, { status: 404 });

  const updates: Partial<typeof columnConfigs.$inferInsert> = {};

  if (body.label !== undefined) {
    const label = cleanString(body.label, 255);
    if (!label) return badRequest("label: neveljavna vrednost");
    updates.label = label;
  }
  if (body.unit !== undefined) {
    const unit = cleanString(body.unit, 50);
    if (!unit) return badRequest("unit: neveljavna enota");
    updates.unit = unit;
  }
  if (body.displayOrder !== undefined) {
    if (!Number.isInteger(body.displayOrder)) return badRequest("displayOrder mora biti celo število");
    updates.displayOrder = body.displayOrder as number;
  }
  if (body.visible !== undefined) {
    if (typeof body.visible !== "boolean") return badRequest("visible mora biti boolean");
    updates.visible = body.visible;
  }

  const newSource = body.sourceType !== undefined ? body.sourceType : current.sourceType;
  if (!isSourceType(newSource)) return badRequest(`sourceType: ${SOURCE_TYPES.join(" | ")}`);
  if (body.sourceType !== undefined) updates.sourceType = newSource;

  if (newSource === "formula") {
    const f = body.formula !== undefined ? body.formula : current.formula;
    const formula = typeof f === "string" ? f.trim() : "";
    const others = all.filter((c) => c.id !== id);
    const err = validateFormula(formula, {
      knownKeys: all.map((c) => c.key),
      ownKey: current.key,
      formulaMap: buildFormulaMap(others),
    });
    if (err) return badRequest(`Formula: ${err}`);
    updates.formula = formula;
    updates.editable = false;
  } else {
    if (body.sourceType !== undefined || body.formula !== undefined) updates.formula = null;
    if (body.editable !== undefined) {
      if (typeof body.editable !== "boolean") return badRequest("editable mora biti boolean");
      updates.editable = body.editable;
    }
  }

  if (Object.keys(updates).length === 0) return badRequest("Ni sprememb");
  await db.update(columnConfigs).set(updates).where(eq(columnConfigs.id, id));
  await logAction(g.user.username, "column_update", `${current.key}: ${Object.keys(updates).join(", ")}`);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const id = parseId(new URL(request.url).searchParams.get("id"));
  if (!id) return badRequest("id required");

  const all = await db.select().from(columnConfigs);
  const target = all.find((c) => c.id === id);
  if (!target) return NextResponse.json({ error: "Stolpec ne obstaja" }, { status: 404 });

  // ne dovoli brisanja stolpca, ki ga uporablja kakšna formula (sicer bi ta tiho vračala 0)
  const users = all.filter(
    (c) => c.id !== id && c.sourceType === "formula" && c.formula && extractFormulaKeys(c.formula).includes(target.key)
  );
  if (users.length) {
    return NextResponse.json(
      { error: `Stolpec uporabljajo formule: ${users.map((c) => c.label).join(", ")}. Najprej jih uredi.` },
      { status: 409 }
    );
  }

  await db.delete(columnConfigs).where(eq(columnConfigs.id, id));
  await logAction(g.user.username, "column_delete", target.key);
  return NextResponse.json({ success: true });
}
