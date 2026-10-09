import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { fetchT } from "@/lib/http";

// SolarEdge omejuje API na ~300 klicev/dan; rezultat zato kratek čas hranimo.
const TTL_MS = 30_000;
let cache: { at: number; body: Record<string, unknown> } | null = null;

export async function GET() {
  const g = await requireUser();
  if (!g.ok) return g.res;

  const key = process.env.SOLAREDGE_API_KEY;
  const site = process.env.SOLAREDGE_SITE_ID;
  if (!key || !site) {
    return NextResponse.json({ error: "SolarEdge API keys not set" }, { status: 400 });
  }

  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body);

  try {
    const url = `https://monitoringapi.solaredge.com/site/${encodeURIComponent(site)}/currentPowerFlow?api_key=${encodeURIComponent(key)}`;
    const res = await fetchT(url, { cache: "no-store" }, 10000);
    if (!res.ok) return NextResponse.json({ error: `SolarEdge HTTP ${res.status}` }, { status: 502 });
    const data = await res.json();

    const flow = data.siteCurrentPowerFlow;
    if (!flow) return NextResponse.json({ error: "No power flow data" }, { status: 404 });

    // from: "LOAD", to: "Grid" = oddaja v omrežje (višek)
    const connections: Array<{ from?: string; to?: string }> = flow.connections || [];
    const gridExporting = connections.some(
      (c) => c.from?.toUpperCase() === "LOAD" && c.to?.toUpperCase() === "GRID"
    );

    const divisor = flow.unit === "W" ? 1000 : 1;
    const body = {
      pv: (flow.PV?.currentPower ?? 0) / divisor,
      load: (flow.LOAD?.currentPower ?? 0) / divisor,
      grid: (flow.GRID?.currentPower ?? 0) / divisor,
      gridExporting,
      unit: "kW",
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "Failed to fetch live data" }, { status: 502 });
  }
}
