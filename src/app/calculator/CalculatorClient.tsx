"use client";

import { useState, useEffect, useCallback } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { sl } from "date-fns/locale";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings, Calculator } from "lucide-react";
import Link from "next/link";
import { evaluateFormula } from "@/lib/formula";
import { useTheme } from "@/lib/ThemeContext";

type ColumnConfig = { id: number; key: string; label: string; displayOrder: number; sourceType: string; formula: string | null; unit: string | null; editable: boolean; visible: boolean };
type DailyRow = { date: string; columnKey: string; value: number };
type Tariff = Record<string, number>;

export default function CalculatorClient() {
  const { theme } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [monthData, setMonthData] = useState<DailyRow[]>([]);
  const [tariff, setTariff] = useState<Tariff>({});
  const [loading, setLoading] = useState(true);
  const [showTariff, setShowTariff] = useState(false);

  const monthKey = format(currentMonth, "yyyy-MM");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [colRes, dataRes, tarRes] = await Promise.all([
      fetch("/api/columns"),
      fetch(`/api/data?month=${monthKey}`),
      fetch("/api/tariff"),
    ]);
    setColumns((await colRes.json()).columns || []);
    setMonthData((await dataRes.json()).data || []);
    setTariff((await tarRes.json()).tariff || {});
    setLoading(false);
  }, [monthKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build lookup
  const lookup: Record<string, Record<string, number>> = {};
  monthData.forEach(r => { if (!lookup[r.date]) lookup[r.date] = {}; lookup[r.date][r.columnKey] = r.value ?? 0; });

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });

  // Get monthly totals
  const getTotal = (key: string): number => {
    const col = columns.find(c => c.key === key);
    if (!col) return 0;
    return days.reduce((sum, d) => {
      const dateStr = format(d, "yyyy-MM-dd");
      const dayVals = lookup[dateStr] || {};
      if (col.sourceType === "formula" && col.formula) return sum + evaluateFormula(col.formula, dayVals);
      return sum + (dayVals[key] ?? 0);
    }, 0);
  };

  const skupnaPoraba = getTotal("skupna_poraba");     // kWh – vse kar hiša porabi
  const solarnaProizvodnja = getTotal("solarna");      // kWh – sončna elektrarna
  const visekManjko = getTotal("visek_manjko");        // kWh – pozitivno = izvoz, negativno = uvoz

  // MojElektro bloki (A+ uvoz po blokih)
  const meBlok1 = getTotal("me_blok1");
  const meBlok2 = getTotal("me_blok2");
  const meBlok3 = getTotal("me_blok3");
  const meBlok4 = getTotal("me_blok4");
  const meBlok5 = getTotal("me_blok5");
  const meUvoz = getTotal("me_uvoz");
  const meOddaja = getTotal("me_oddaja"); // A- (Oddaja v omrežje)
  const hasMojelektro = meUvoz > 0;

  const t = tariff;
  const mNum = currentMonth.getMonth() + 1;
  const isHighSeason = mNum === 11 || mNum === 12 || mNum === 1 || mNum === 2;
  const activeBlocks = isHighSeason ? [1, 2, 3, 4] : [2, 3, 4, 5];
  const aktivniBloki = activeBlocks;

  // Samooskrba = Proizvodnja (SolarEdge) - Oddaja (MojElektro)
  // To je energija, ki smo jo porabili neposredno iz sonca
  const samooskrbaKwh = Math.max(0, solarnaProizvodnja - meOddaja);

  /**
   * Hipotetična poraba po blokih (kot da SE ne bi bilo):
   * Dejanski uvoz (A+) + Samooskrba (ki bi bila uvoz).
   * Samooskrbo porazdelimo v "dnevne" bloke 1, 2 in 3.
   */
  const hipoBlok1 = isHighSeason ? meBlok1 + (samooskrbaKwh * 0.6) : 0; // Večina sonca v Blok 1
  const hipoBlok2 = isHighSeason ? meBlok2 + (samooskrbaKwh * 0.4) : meBlok2 + (samooskrbaKwh * 0.7);
  const hipoBlok3 = isHighSeason ? meBlok3 : meBlok3 + (samooskrbaKwh * 0.3);
  const hipoBlok4 = meBlok4;
  const hipoBlok5 = meBlok5;

  const hipoSkupnaPoraba = hasMojelektro ? (hipoBlok1 + hipoBlok2 + hipoBlok3 + hipoBlok4 + hipoBlok5) : skupnaPoraba;

  const calcDogMoc = () => {
    let sum = 0;
    if (activeBlocks.includes(1)) sum += (t.moc_blok1 ?? 7.2) * (t.cena_moc_blok1 ?? 3.82301);
    if (activeBlocks.includes(2)) sum += (t.moc_blok2 ?? 7.2) * (t.cena_moc_blok2 ?? 1.09230);
    if (activeBlocks.includes(3)) sum += (t.moc_blok3 ?? 7.2) * (t.cena_moc_blok3 ?? 0.28902);
    if (activeBlocks.includes(4)) sum += (t.moc_blok4 ?? 7.2) * (t.cena_moc_blok4 ?? 0.02436);
    if (activeBlocks.includes(5)) sum += (t.moc_blok5 ?? 7.2) * (t.cena_moc_blok5 ?? 0.00245);
    return sum;
  };

  const dogMocStrosek = calcDogMoc();
  const spteMoc = t.moc_blok1 ?? 7.2;

  // ═══════════════════════════════════════════
  // SCENARIJ 1: BREZ sončne elektrarne
  // ═══════════════════════════════════════════
  const brezSE_energija = hipoSkupnaPoraba * (t.cena_energija_et || 0.1299);
  const brezSE_omreznina_energija = hasMojelektro ? 
      (hipoBlok1 * (t.cena_omreznina_blok1 || 0.01864)) + // Uporabimo ceno omrežnine na blok
      (hipoBlok2 * (t.cena_omreznina_blok2 || 0.01864)) +
      (hipoBlok3 * (t.cena_omreznina_blok3 || 0.01864)) +
      (hipoBlok4 * (t.cena_omreznina_blok4 || 0.01864)) +
      (hipoBlok5 * (t.cena_omreznina_blok5 || 0.01864))
    : hipoSkupnaPoraba * (t.cena_omreznina_et || 0.01864);

  const brezSE_dog_moc = dogMocStrosek;
  const brezSE_prisp_trg = hipoSkupnaPoraba * (t.prisp_operater_trg || 0.00013);
  const brezSE_prisp_ucinkovitost = hipoSkupnaPoraba * (t.prisp_energ_ucinkovitost || 0.0008);
  const brezSE_prisp_spte = spteMoc * (t.prisp_spte_ove || 0.77562);
  const brezSE_trosarina = hipoSkupnaPoraba * (t.trosarina || 0.00153);
  const brezSE_nadomestilo = t.mesecno_nadomestilo || 1.99;
  
  const brezSE_skupaj_brezDDV =
    brezSE_energija + brezSE_omreznina_energija + brezSE_dog_moc +
    brezSE_prisp_trg + brezSE_prisp_ucinkovitost + brezSE_prisp_spte +
    brezSE_trosarina + brezSE_nadomestilo;
  const brezSE_ddv = brezSE_skupaj_brezDDV * (t.ddv_stopnja || 0.22);
  const brezSE_skupaj = brezSE_skupaj_brezDDV + brezSE_ddv;

  // ═══════════════════════════════════════════
  // SCENARIJ 2: S sončno elektrarno (dejanski)
  // ═══════════════════════════════════════════
  // EZ-1 samooskrba: mesečno plačaš SAMO fiksne stroške.
  // Energija (kWh) se neto obračuna LETNO.
  const sSE_dog_moc = dogMocStrosek;
  const sSE_prisp_spte = brezSE_prisp_spte;
  const sSE_nadomestilo = t.mesecno_nadomestilo || 1.99;
  const sSE_eko = t.eko_popust || -1;

  const sSE_skupaj_brezDDV = sSE_dog_moc + sSE_prisp_spte + sSE_nadomestilo + sSE_eko;
  const sSE_ddv = sSE_skupaj_brezDDV * (t.ddv_stopnja || 0.22);
  const sSE_skupaj = sSE_skupaj_brezDDV + sSE_ddv;

  // Prihranek
  const prihranek = brezSE_skupaj - sSE_skupaj;

  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  const fmtKwh = (n: number) => n.toFixed(1).replace(".", ",");

  const handleSaveTariff = async () => {
    // Collect all expected keys to ensure everything is saved
    const keys = [
      "cena_energija_et", "cena_omreznina_et",
      "cena_moc_blok1", "cena_moc_blok2", "cena_moc_blok3", "cena_moc_blok4", "cena_moc_blok5",
      "moc_blok1", "moc_blok2", "moc_blok3", "moc_blok4", "moc_blok5",
      "cena_omreznina_blok1", "cena_omreznina_blok2", "cena_omreznina_blok3", "cena_omreznina_blok4", "cena_omreznina_blok5",
      "prisp_operater_trg", "prisp_energ_ucinkovitost", "prisp_spte_ove",
      "trosarina", "mesecno_nadomestilo", "eko_popust", "ddv_stopnja"
    ];
    
    const payload: Tariff = {};
    keys.forEach(k => { payload[k] = tariff[k] ?? 0; });

    await fetch("/api/tariff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tariff: payload }),
    });
    setShowTariff(false);
  };

  const updateTariff = (key: string, val: string) => {
    setTariff(prev => ({ ...prev, [key]: parseFloat(val.replace(",", ".")) || 0 }));
  };

  type LineItem = { label: string; value: number; bold?: boolean; color?: string; sub?: boolean };

  const renderTable = (title: string, emoji: string, items: LineItem[], total: number, totalLabel: string) => (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">{emoji} {title}</h3>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className={`flex justify-between text-xs ${item.bold ? "font-bold border-t border-gray-600 pt-1 mt-1" : ""} ${item.sub ? "text-gray-500 text-[10px] pl-2" : ""}`}>
            <span className={item.color || ""}>{item.label}</span>
            <span className={item.color || ""}>{fmt(item.value)} €</span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-bold border-t-2 border-gray-600 pt-2 mt-2">
          <span>{totalLabel}</span>
          <span>{fmt(total)} €</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
          <h1 className="text-lg font-bold flex items-center gap-2"><Calculator size={20} /> Kalkulator</h1>
        </div>
        <button onClick={() => setShowTariff(!showTariff)} className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs">
          <Settings size={14} /> Tarife
        </button>
      </header>

      <main className="p-3 max-w-2xl mx-auto space-y-4">
        {/* Month nav */}
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronLeft size={18} /></button>
          <span className="text-lg font-bold capitalize">{format(currentMonth, "MMMM yyyy", { locale: sl })}</span>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronRight size={18} /></button>
        </div>

        {loading ? <div className="text-center py-8 text-gray-500">Nalaganje...</div> : (<>

          {/* Energy summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-[9px] text-gray-400">Skupna poraba</div>
              <div className="text-lg font-bold text-yellow-400">{fmtKwh(skupnaPoraba)}</div>
              <div className="text-[9px] text-gray-500">kWh</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-[9px] text-gray-400">Proizvodnja</div>
              <div className="text-lg font-bold text-green-400">{fmtKwh(solarnaProizvodnja)}</div>
              <div className="text-[9px] text-gray-500">kWh</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-[9px] text-gray-400">Samooskrba</div>
              <div className="text-lg font-bold text-cyan-400">{fmtKwh(samooskrbaKwh)}</div>
              <div className="text-[9px] text-gray-500">kWh</div>
            </div>
          </div>

          {/* Scenario 1: BREZ sončne */}
          {renderTable(`BREZ sončne – ${fmtKwh(hipoSkupnaPoraba)} kWh`, "🔴", [
            { label: "Električna energija", value: brezSE_energija, sub: true },
            { label: "Omrežnina (energija)", value: brezSE_omreznina_energija, sub: true },
            { label: "Omrežnina (moč)", value: brezSE_dog_moc, sub: true },
            { label: "Prisp. operater trga", value: brezSE_prisp_trg, sub: true },
            { label: "Prisp. energ. učinkovitost", value: brezSE_prisp_ucinkovitost, sub: true },
            { label: "Prisp. SPTE in OVE", value: brezSE_prisp_spte, sub: true },
            { label: "Trošarina", value: brezSE_trosarina, sub: true },
            { label: "Mesečno nadomestilo", value: brezSE_nadomestilo, sub: true },
            { label: "Osnova brez DDV", value: brezSE_skupaj_brezDDV, bold: true },
            { label: `DDV (${((t.ddv_stopnja || 0.22) * 100).toFixed(0)}%)`, value: brezSE_ddv, sub: true },
          ], brezSE_skupaj, "SKUPAJ z DDV")}

          {/* Scenario 2: S sončno – samo fiksni stroški */}
          {renderTable("S sončno elektrarno (EZ-1)", "🟢", [
            { label: "Omrežnina (moč)", value: sSE_dog_moc, sub: true },
            { label: "Prisp. SPTE in OVE", value: sSE_prisp_spte, sub: true },
            { label: "Mesečno nadomestilo", value: sSE_nadomestilo, sub: true },
            { label: "Eko popust", value: sSE_eko, sub: true, color: "text-green-400" },
            { label: "Osnova brez DDV", value: sSE_skupaj_brezDDV, bold: true },
            { label: `DDV (${((t.ddv_stopnja || 0.22) * 100).toFixed(0)}%)`, value: sSE_ddv, sub: true },
          ], sSE_skupaj, "SKUPAJ z DDV")}

          <div className="bg-gray-800/50 rounded p-2 text-[10px] text-gray-500 text-center">
            ℹ️ EZ-1 samooskrba: energija se neto obračuna <strong>letno</strong>. Mesečno plačuješ samo fiksne stroške.
          </div>

          {/* MojElektro bloki */}
          {hasMojelektro && (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                ⚡ Poraba po blokih <span className="text-[10px] font-normal text-gray-400">(vir: MojElektro)</span>
              </h3>
              <div className="grid grid-cols-5 gap-1 mb-3">
                {[
                  { b: 1, v: meBlok1 },
                  { b: 2, v: meBlok2 },
                  { b: 3, v: meBlok3 },
                  { b: 4, v: meBlok4 },
                  { b: 5, v: meBlok5 },
                ].map(({ b, v }) => {
                  const isActive = aktivniBloki.includes(b);
                  return (
                    <div key={b} className={`rounded-lg p-2 text-center border ${isActive ? "border-blue-600 bg-blue-900/20" : "border-gray-700 opacity-50"}`}>
                      <div className="text-[8px] text-gray-400">Blok {b}</div>
                      <div className="text-xs font-bold text-blue-300">{fmtKwh(v)}</div>
                      <div className="text-[8px] text-gray-500">kWh</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-gray-500 text-center">
                {isHighSeason ? "🔴 Višja sezona: bloki 1–4 aktivni" : "🟡 Nižja sezona: bloki 2–5 aktivni"}
              </div>
            </div>
          )}

          {!hasMojelektro && (
            <div className="bg-gray-800/50 rounded-xl p-3 text-center border border-dashed border-gray-700">
              <p className="text-xs text-gray-500">
                Za natančno porabo po blokih nastavi <code className="text-gray-400">MOJELEKTRO_API_KEY</code> in <code className="text-gray-400">MOJELEKTRO_EIMM</code> v .env.
              </p>
            </div>
          )}

          {/* Prihranek */}
          <div className={`rounded-xl p-5 text-center ${prihranek > 0 ? "bg-green-900/30 border border-green-700" : "bg-red-900/30 border border-red-700"}`}>
            <div className="text-xs text-gray-400 mb-1">Mesečni prihranek s sončno elektrarno</div>
            <div className={`text-3xl font-bold ${prihranek > 0 ? "text-green-400" : "text-red-400"}`}>
              {prihranek > 0 ? "+" : ""}{fmt(prihranek)} €
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Letno (ocena): <strong>{fmt(prihranek * 12)} €</strong>
            </div>
          </div>

        </>)}

        {/* Tariff settings modal */}
        {showTariff && (
          <div className="bg-gray-800 rounded-xl p-4 space-y-3 border border-gray-600 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-sm">⚙️ Nastavitve tarife</h3>
            <p className="text-[10px] text-gray-500">Omrežnina se obračunava glede na sezono (Višja: nov-feb, Nižja: mar-okt).</p>
            
            <div className="bg-gray-900 p-2 rounded">
              <h4 className="font-bold text-[11px] mb-2 text-blue-400">Dogovorjena moč (kW)</h4>
              <div className="grid grid-cols-5 gap-1">
                {[1,2,3,4,5].map(b => (
                  <div key={`moc_${b}`}>
                    <label className="block text-[8px] text-gray-400 mb-0.5 text-center">Blok {b}</label>
                    <input type="text" inputMode="decimal" value={String(tariff[`moc_blok${b}`] ?? 7.2)} onChange={e => updateTariff(`moc_blok${b}`, e.target.value)} className="w-full bg-gray-700 px-1 py-1 rounded text-[10px] text-center" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900 p-2 rounded">
              <h4 className="font-bold text-[11px] mb-2 text-green-400">Cena moči (€/kW)</h4>
              <div className="grid grid-cols-5 gap-1">
                {[1,2,3,4,5].map(b => (
                  <div key={`cena_${b}`}>
                    <label className="block text-[8px] text-gray-400 mb-0.5 text-center">Blok {b}</label>
                    <input type="text" inputMode="decimal" value={String(tariff[`cena_moc_blok${b}`] ?? 0)} onChange={e => updateTariff(`cena_moc_blok${b}`, e.target.value)} className="w-full bg-gray-700 px-1 py-1 rounded text-[10px] text-center" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900 p-2 rounded">
              <h4 className="font-bold text-[11px] mb-2 text-yellow-400">Cena prenesene energije (€/kWh)</h4>
              <div className="grid grid-cols-5 gap-1">
                {[1,2,3,4,5].map(b => (
                  <div key={`cena_e_${b}`}>
                    <label className="block text-[8px] text-gray-400 mb-0.5 text-center">Blok {b}</label>
                    <input type="text" inputMode="decimal" value={String(tariff[`cena_omreznina_blok${b}`] ?? 0)} onChange={e => updateTariff(`cena_omreznina_blok${b}`, e.target.value)} className="w-full bg-gray-700 px-1 py-1 rounded text-[10px] text-center" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                ["cena_energija_et", "Energija ET (€/kWh)"],
                ["prisp_operater_trg", "Prisp. oper. trga (€/kWh)"],
                ["prisp_energ_ucinkovitost", "Prisp. učink. (€/kWh)"],
                ["prisp_spte_ove", "SPTE+OVE (€/kW)"],
                ["trosarina", "Trošarina (€/kWh)"],
                ["mesecno_nadomestilo", "Mesečno nadom. (€)"],
                ["eko_popust", "Eko popust (€)"],
                ["ddv_stopnja", "DDV (decimalno, npr. 0.22)"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-[9px] text-gray-400 mb-0.5">{label}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={String(tariff[key] ?? "")}
                    onChange={e => updateTariff(key, e.target.value)}
                    className="w-full bg-gray-700 px-2 py-1 rounded text-xs text-white"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2 sticky bottom-0 bg-gray-800 p-2 border-t border-gray-700">
              <button onClick={handleSaveTariff} className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded text-sm font-bold text-white">Shrani</button>
              <button onClick={() => setShowTariff(false)} className="flex-1 bg-gray-600 py-2 rounded text-sm text-white">Zapri</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
