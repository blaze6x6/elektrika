import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

// Default tariff based on the GEN-I invoice screenshot
const DEFAULT_TARIFF = {
  // Električna energija
  cena_energija_et: 0.129900,     // EUR/kWh – enotna tarifa
  cena_omreznina_et: 0.018640,    // EUR/kWh (pavšalna, če ni blokov)

  // Omrežnina - cene za preneseno energijo po blokih (€/kWh)
  // Vrednosti iz aktualnih GEN-I cenikov za 2024+
  cena_omreznina_blok1: 0.01958,
  cena_omreznina_blok2: 0.01182,
  cena_omreznina_blok3: 0.00392,
  cena_omreznina_blok4: 0.00033,
  cena_omreznina_blok5: 0.00003,
  
  // Cene za bloke dogovorjene moči (€/kW)
  cena_moc_blok1: 3.82301,
  cena_moc_blok2: 1.09230,
  cena_moc_blok3: 0.28902,
  cena_moc_blok4: 0.02436,
  cena_moc_blok5: 0.00245,

  // Dogovorjena moč po blokih (kW)
  moc_blok1: 7.2,
  moc_blok2: 7.2,
  moc_blok3: 7.2,
  moc_blok4: 7.2,
  moc_blok5: 7.2,

  // Prispevki
  prisp_operater_trg: 0.000130,   // EUR/kWh
  prisp_energ_ucinkovitost: 0.000800, // EUR/kWh
  prisp_spte_ove: 0.775620,       // EUR/kW
  trosarina: 0.001530,            // EUR/kWh
  mesecno_nadomestilo: 1.990000,  // EUR/kos
  eko_popust: -1.000000,          // EUR/kos
  ddv_stopnja: 0.22,              // 22%
};

export async function GET() {
  const rows = await db.select().from(appSettings);
  const settings: Record<string, string> = {};
  rows.forEach(r => { settings[r.key] = r.value || ""; });

  // Build tariff from settings or defaults
  const tariff: Record<string, number> = {};
  for (const [key, defaultVal] of Object.entries(DEFAULT_TARIFF)) {
    const settingKey = `tariff_${key}`;
    tariff[key] = settings[settingKey] ? parseFloat(settings[settingKey]) : defaultVal;
  }

  return NextResponse.json({ tariff });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { tariff } = body;

  if (!tariff || typeof tariff !== "object") {
    return NextResponse.json({ error: "tariff object required" }, { status: 400 });
  }

  for (const [key, value] of Object.entries(tariff)) {
    const settingKey = `tariff_${key}`;
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, settingKey));
    if (existing) {
      await db.update(appSettings).set({ value: String(value) }).where(eq(appSettings.key, settingKey));
    } else {
      await db.insert(appSettings).values({ key: settingKey, value: String(value) });
    }
  }

  return NextResponse.json({ success: true });
}
