import { NextResponse } from "next/server";

export async function GET() {
  const solaredgeKey = process.env.SOLAREDGE_API_KEY;
  const solaredgeSite = process.env.SOLAREDGE_SITE_ID;

  if (!solaredgeKey || !solaredgeSite) {
    return NextResponse.json({ error: "SolarEdge API keys not set" }, { status: 400 });
  }

  try {
    const url = `https://monitoringapi.solaredge.com/site/${solaredgeSite}/currentPowerFlow?api_key=${solaredgeKey}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    const flow = data.siteCurrentPowerFlow;
    if (!flow) {
      return NextResponse.json({ error: "No power flow data" }, { status: 404 });
    }

    // Determine grid direction from connections array
    // from: "GRID", to: "Load" = importing (buying from grid)
    // from: "LOAD", to: "Grid" = exporting (selling to grid)
    const connections: Array<{ from: string; to: string }> = flow.connections || [];
    
    let gridExporting = false; // true = oddaja v omrežje (višek)
    for (const conn of connections) {
      const from = conn.from?.toUpperCase();
      const to = conn.to?.toUpperCase();
      if (from === "LOAD" && to === "GRID") {
        gridExporting = true;
      }
    }

    const unit = flow.unit || "kW";
    const pvPower = flow.PV?.currentPower ?? 0;
    const loadPower = flow.LOAD?.currentPower ?? 0;
    const gridPower = flow.GRID?.currentPower ?? 0;

    // Convert W to kW if needed
    const divisor = unit === "W" ? 1000 : 1;

    return NextResponse.json({
      pv: pvPower / divisor,
      load: loadPower / divisor,
      grid: gridPower / divisor,
      gridExporting, // true = oddaja (zeleno ↑), false = uvoz (rdeče ↓)
      unit: "kW",
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch live data" }, { status: 500 });
  }
}
