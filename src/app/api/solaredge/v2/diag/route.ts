import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { v2Get } from "@/lib/solaredge-v2";

// Samo branje, samo znane poti (diagnostika – vsak klic porabi 1 kredit).
const PATHS = new Set(["", "/overview", "/energy", "/power", "/lifetime-energy", "/meters/telemetry", "/inverters/telemetry", "/devices"]);
const RESOLUTIONS = new Set(["QUARTER_HOUR", "HOUR", "DAY", "WEEK", "MONTH", "YEAR", "TOTAL"]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

export async function GET(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const q = new URL(request.url).searchParams;
  const path = q.get("path") ?? "";
  if (!PATHS.has(path)) return NextResponse.json({ error: "Pot ni dovoljena." }, { status: 400 });

  const params: Record<string, string> = {};
  for (const k of ["from", "to"]) {
    const v = q.get(k);
    if (v) {
      if (!ISO.test(v)) return NextResponse.json({ error: `${k}: pričakovan ISO 8601 z odmikom (npr. 2026-10-14T00:00:00+02:00)` }, { status: 400 });
      params[k] = v;
    }
  }
  const res = q.get("resolution");
  if (res) {
    if (!RESOLUTIONS.has(res)) return NextResponse.json({ error: "resolution ni veljavna" }, { status: 400 });
    params.resolution = res;
  }
  if (q.get("unit") && /^[A-Z_]{1,12}$/.test(q.get("unit")!)) params.unit = q.get("unit")!;

  try {
    const r = await v2Get(path, params);
    return NextResponse.json({ request: { path: `/sites/{id}${path}`, params }, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Napaka" }, { status: 502 });
  }
}
