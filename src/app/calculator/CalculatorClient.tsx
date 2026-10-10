"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useState, useEffect, useCallback } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { sl } from "date-fns/locale";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings, Calculator } from "lucide-react";
import Link from "next/link";
import { buildFormulaMap, evaluateFormula } from "@/lib/formula";
import { DEFAULT_TARIFF } from "@/lib/tariff";
import { activeBlocksForMonth, blocksOccurringOn, isHighSeasonMonth, solarBlockShares, type Block } from "@/lib/blocks";

type ColumnConfig = { id: number; key: string; label: string; displayOrder: number; sourceType: string; formula: string | null; unit: string | null; editable: boolean; visible: boolean };
type DailyRow = { date: string; columnKey: string; value: number };
type Tariff = Record<string, number>;

export default function CalculatorClient() {
  const [currentMonth, setCurrentMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [monthData, setMonthData] = useState<DailyRow[]>([]);
  const [tariff, setTariff] = useState<Tariff>({});
  const [loading, setLoading] = useState(true);
  const [showTariff, setShowTariff] = useState(false);
  const [rezim, setRezimState] = useState<"letno" | "bloki">("letno");

  useEffect(() => {
    try { if (localStorage.getItem("calc_rezim") === "bloki") setRezimState("bloki"); } catch { /* brez shrambe */ }
  }, []);
  const setRezim = (r: "letno" | "bloki") => {
    setRezimState(r);
    try { localStorage.setItem("calc_rezim", r); } catch { /* brez shrambe */ }
  };

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

  const formulaMap = buildFormulaMap(columns);

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
      if (col.sourceType === "formula" && col.formula) return sum + evaluateFormula(col.formula, dayVals, formulaMap);
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

  // Privzete vrednosti dopolnijo manjkajoče ključe; nastavljena 0 je veljavna vrednost (zato ??, ne ||).
  const t: Tariff = { ...DEFAULT_TARIFF, ...tariff };
  const mNum = currentMonth.getMonth() + 1;
  const isHighSeason = isHighSeasonMonth(mNum);
  const activeBlocks = activeBlocksForMonth(mNum);
  const aktivniBloki: number[] = activeBlocks;

  const dayValue = (key: string, dateStr: string): number => {
    const col = columns.find(c => c.key === key);
    const dayVals = lookup[dateStr] || {};
    if (col?.sourceType === "formula" && col.formula) return evaluateFormula(col.formula, dayVals, formulaMap);
    return dayVals[key] ?? 0;
  };

  // Samooskrba po blokih: najprej dejanske urne meritve SolarEdge (se_samo_blok1..5),
  // sicer ocena = (proizvodnja − oddaja) razporejena po urnem profilu sonca.
  // Če imamo MojElektro, v hipotetični izračun štejemo samo dni, za katere ima podatke tudi MojElektro
  // (sicer bi bil uvoz za nekaj dni, samooskrba pa za cel mesec).
  const meBloki = [meBlok1, meBlok2, meBlok3, meBlok4, meBlok5];
  const samooskrbaPoBlokih = [0, 0, 0, 0, 0];
  let samooskrbaKwh = 0;       // ves mesec (prikaz)
  let daysMeasured = 0;        // dni iz meritev, vključenih v izračun
  let daysEstimated = 0;       // dni z oceno, vključenih v izračun
  let daysWithSolar = 0;
  let daysWithMe = 0;
  const kupSum = [0, 0, 0, 0, 0]; // SolarEdge Purchased po blokih (samo dni, ko so podatki tudi v MojElektro)
  const meCmpSum = [0, 0, 0, 0, 0];
  days.forEach(d => {
    const ds = format(d, "yyyy-MM-dd");
    const meDay = [1, 2, 3, 4, 5].map(b => dayValue(`me_blok${b}`, ds));
    const hasMeDay = meDay.reduce((a, b) => a + b, 0) > 0;
    if (hasMeDay) daysWithMe++;
    if (dayValue("solarna", ds) > 0) daysWithSolar++;

    const measured = [1, 2, 3, 4, 5].map(b => dayValue(`se_samo_blok${b}`, ds));
    const measuredSum = measured.reduce((a, b) => a + b, 0);
    const self = measuredSum > 0 ? measuredSum : Math.max(0, dayValue("solarna", ds) - dayValue("me_oddaja", ds));
    samooskrbaKwh += self;

    if (hasMojelektro && !hasMeDay) return;
    const kup = [1, 2, 3, 4, 5].map(b => dayValue(`se_kup_blok${b}`, ds));
    if (hasMeDay && kup.reduce((a, b) => a + b, 0) > 0) {
      kup.forEach((v, i) => { kupSum[i] += v; meCmpSum[i] += meDay[i]; });
    }
    if (measuredSum > 0) {
      daysMeasured++;
      measured.forEach((v, i) => { samooskrbaPoBlokih[i] += v; });
    } else if (self > 0) {
      daysEstimated++;
      solarBlockShares(ds).forEach((sh, i) => { samooskrbaPoBlokih[i] += self * sh; });
    }
  });
  const coverageGap = hasMojelektro && daysWithMe < daysWithSolar;
  // Kontrola: uvoz po blokih po SolarEdge (Purchased) proti MojElektro. Večje razlike = napačna preslikava blokov ali zamik ur.
  const cmpBad: number[] = [];
  if (kupSum.reduce((a, b) => a + b, 0) > 0) {
    kupSum.forEach((v, i) => { if (Math.abs(v - meCmpSum[i]) > Math.max(1, meCmpSum[i] * 0.1)) cmpBad.push(i + 1); });
  }

  /** Hipotetična poraba po blokih (kot da sončne ne bi bilo) = dejanski uvoz (A+) + samooskrba po urnem profilu sonca. */
  const hipoBloki = meBloki.map((v, i) => v + samooskrbaPoBlokih[i]);
  const hipoSkupnaPoraba = hasMojelektro ? hipoBloki.reduce((a, b) => a + b, 0) : skupnaPoraba;

  // Preverjanje podatkov MojElektro: ali so bloki skladni z uradnim urnikom in uvozom?
  const blockSum = meBloki.reduce((a, b) => a + b, 0);
  const sumMismatch = hasMojelektro && Math.abs(blockSum - meUvoz) > Math.max(0.5, meUvoz * 0.01);
  let impossibleDays = 0;
  if (hasMojelektro) {
    days.forEach(d => {
      const ds = format(d, "yyyy-MM-dd");
      const occurs = blocksOccurringOn(ds);
      for (let b = 1; b <= 5; b++) {
        if (dayValue(`me_blok${b}`, ds) > 0.01 && !occurs.includes(b as Block)) { impossibleDays++; break; }
      }
    });
  }

  const moc = (b: number) => t[`moc_blok${b}`] * t[`cena_moc_blok${b}`];
  const dogMocStrosek = activeBlocks.reduce((sum, b) => sum + moc(b), 0);
  const spteMoc = t.moc_blok1;

  // Letno netiranje (priključno soglasje do 2023) ali obračun po blokih za vso prevzeto energijo (od 2024).
  const netRezim = rezim;

  // ═══════════════════════════════════════════
  // SCENARIJ 1: BREZ sončne elektrarne
  // ═══════════════════════════════════════════
  const costEnergy = (kwh: number) => kwh * t.cena_energija_et;
  const costOmrEnergija = (bloki: number[], total: number) =>
    hasMojelektro ? bloki.reduce((sum, v, i) => sum + v * t[`cena_omreznina_blok${i + 1}`], 0) : total * t.cena_omreznina_et;

  const brezSE_energija = costEnergy(hipoSkupnaPoraba);
  const brezSE_omreznina_energija = costOmrEnergija(hipoBloki, hipoSkupnaPoraba);
  const brezSE_dog_moc = dogMocStrosek;
  const brezSE_prisp_trg = hipoSkupnaPoraba * t.prisp_operater_trg;
  const brezSE_prisp_ucinkovitost = hipoSkupnaPoraba * t.prisp_energ_ucinkovitost;
  const brezSE_prisp_spte = spteMoc * t.prisp_spte_ove;
  const brezSE_trosarina = hipoSkupnaPoraba * t.trosarina;
  const brezSE_nadomestilo = t.mesecno_nadomestilo;
  const brezSE_eko = t.eko_popust;

  const brezSE_skupaj_brezDDV =
    brezSE_energija + brezSE_omreznina_energija + brezSE_dog_moc +
    brezSE_prisp_trg + brezSE_prisp_ucinkovitost + brezSE_prisp_spte +
    brezSE_trosarina + brezSE_nadomestilo + brezSE_eko;
  const brezSE_ddv = brezSE_skupaj_brezDDV * t.ddv_stopnja;
  const brezSE_skupaj = brezSE_skupaj_brezDDV + brezSE_ddv;

  // ═══════════════════════════════════════════
  // SCENARIJ 2: S sončno elektrarno (dejanski)
  // ═══════════════════════════════════════════
  // "letno": mesečno plačaš samo fiksne stroške, energija se neto obračuna letno.
  // "bloki": plačaš vso prevzeto energijo iz omrežja (A+) po blokih; oddaja se ne všteva (previdna ocena).
  const uvozKwh = hasMojelektro ? meUvoz : Math.max(0, skupnaPoraba - solarnaProizvodnja);
  const sSE_blokiAktivni = netRezim === "bloki";
  const sSE_energija = sSE_blokiAktivni ? costEnergy(uvozKwh) : 0;
  const sSE_omreznina_energija = sSE_blokiAktivni ? costOmrEnergija(meBloki, uvozKwh) : 0;
  const sSE_prisp_trg = sSE_blokiAktivni ? uvozKwh * t.prisp_operater_trg : 0;
  const sSE_prisp_ucinkovitost = sSE_blokiAktivni ? uvozKwh * t.prisp_energ_ucinkovitost : 0;
  const sSE_trosarina = sSE_blokiAktivni ? uvozKwh * t.trosarina : 0;
  const sSE_dog_moc = dogMocStrosek;
  const sSE_prisp_spte = brezSE_prisp_spte;
  const sSE_nadomestilo = t.mesecno_nadomestilo;
  const sSE_eko = t.eko_popust;

  const sSE_skupaj_brezDDV =
    sSE_energija + sSE_omreznina_energija + sSE_dog_moc + sSE_prisp_trg + sSE_prisp_ucinkovitost +
    sSE_prisp_spte + sSE_trosarina + sSE_nadomestilo + sSE_eko;
  const sSE_ddv = sSE_skupaj_brezDDV * t.ddv_stopnja;
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

    const res = await fetch("/api/tariff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tariff: payload }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(res.status === 403 ? "Tarife lahko spreminja samo skrbnik." : `Shranjevanje ni uspelo: ${j.error || res.status}`);
      return;
    }
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
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTariff(!showTariff)} className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs">
            <Settings size={14} /> Tarife
          </button>
          <ThemeSwitcher />
        </div>
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
            { label: "Eko popust", value: brezSE_eko, sub: true, color: "text-green-400" },
            { label: "Osnova brez DDV", value: brezSE_skupaj_brezDDV, bold: true },
            { label: `DDV (${(t.ddv_stopnja * 100).toFixed(0)}%)`, value: brezSE_ddv, sub: true },
          ], brezSE_skupaj, "SKUPAJ z DDV")}

          {/* Način obračuna s sončno */}
          <div className="bg-gray-800 rounded-xl p-3 text-xs space-y-2">
            <div className="text-gray-400">Obračun s sončno elektrarno:</div>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => setRezim("letno")} className={`rounded px-2 py-1.5 ${rezim === "letno" ? "bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600"}`}>
                Letno netiranje<span className="block text-[9px] opacity-80">soglasje do 2023</span>
              </button>
              <button onClick={() => setRezim("bloki")} className={`rounded px-2 py-1.5 ${rezim === "bloki" ? "bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600"}`}>
                Po blokih (brez netiranja)<span className="block text-[9px] opacity-80">soglasje od 2024</span>
              </button>
            </div>
          </div>

          {/* Scenario 2: S sončno */}
          {renderTable(rezim === "letno" ? "S sončno elektrarno (letno netiranje)" : "S sončno elektrarno (obračun po blokih)", "🟢", [
            ...(sSE_blokiAktivni ? [
              { label: "Električna energija", value: sSE_energija, sub: true },
              { label: "Omrežnina (energija)", value: sSE_omreznina_energija, sub: true },
            ] : []),
            { label: "Omrežnina (moč)", value: sSE_dog_moc, sub: true },
            ...(sSE_blokiAktivni ? [
              { label: "Prisp. operater trga", value: sSE_prisp_trg, sub: true },
              { label: "Prisp. energ. učinkovitost", value: sSE_prisp_ucinkovitost, sub: true },
            ] : []),
            { label: "Prisp. SPTE in OVE", value: sSE_prisp_spte, sub: true },
            ...(sSE_blokiAktivni ? [{ label: "Trošarina", value: sSE_trosarina, sub: true }] : []),
            { label: "Mesečno nadomestilo", value: sSE_nadomestilo, sub: true },
            { label: "Eko popust", value: sSE_eko, sub: true, color: "text-green-400" },
            { label: "Osnova brez DDV", value: sSE_skupaj_brezDDV, bold: true },
            { label: `DDV (${(t.ddv_stopnja * 100).toFixed(0)}%)`, value: sSE_ddv, sub: true },
          ], sSE_skupaj, "SKUPAJ z DDV")}

          <div className="bg-gray-800/50 rounded p-2 text-[10px] text-gray-500 text-center">
            {rezim === "letno"
              ? <>ℹ️ Letno netiranje: energija se neto obračuna <strong>letno</strong>, mesečno plačuješ samo fiksne stroške. Prihranek je v tem primeru zgornja meja.</>
              : <>ℹ️ Od 2024 plačaš vso prevzeto energijo po blokih; oddaja v omrežje se ne všteva (dobropis dobavitelja ni upoštevan).</>}
          </div>

          {coverageGap && (
            <div className="bg-yellow-900/40 border border-yellow-700 rounded p-2 text-[11px] text-yellow-300">
              ⚠️ MojElektro ima podatke za {daysWithMe} dni, SolarEdge pa za {daysWithSolar}. Energijski del izračuna velja samo za dni z MojElektro podatki;
              fiksni stroški so mesečni. Po novi sinhronizaciji MojElektro (podatki so z zamikom) se bo izračun dopolnil.
            </div>
          )}

          {cmpBad.length > 0 && (
            <div className="bg-yellow-900/40 border border-yellow-700 rounded p-2 text-[11px] text-yellow-300">
              ⚠️ Kontrola blokov: uvoz po SolarEdge se pri blokih {cmpBad.join(", ")} razlikuje od MojElektro
              ({cmpBad.map(b => `B${b}: ${fmtKwh(kupSum[b - 1])} proti ${fmtKwh(meCmpSum[b - 1])} kWh`).join("; ")}).
              Možen vzrok: drugačna preslikava blokov v MojElektro ali zamik ur v časovnih žigih.
            </div>
          )}

          {(sumMismatch || impossibleDays > 0) && (
            <div className="bg-yellow-900/40 border border-yellow-700 rounded p-2 text-[11px] text-yellow-300">
              ⚠️ Podatki MojElektro se ne ujemajo z uradnim urnikom blokov
              {sumMismatch && <> (vsota blokov {fmtKwh(blockSum)} kWh ≠ uvoz {fmtKwh(meUvoz)} kWh)</>}
              {impossibleDays > 0 && <> ({impossibleDays} dni s porabo v bloku, ki ta dan ne obstaja)</>}.
              Preveri preslikavo blokov v MojElektro diagnostiki; izračun po blokih je lahko napačen.
            </div>
          )}

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

          {/* Hipotetična poraba brez sončne */}
          {hasMojelektro && (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
                🌙 Hipotetična poraba brez sončne
                <span className="text-[10px] font-normal text-gray-400">(informativno)</span>
              </h3>
              <p className="text-[11px] text-gray-500 mb-3">Dejanski uvoz iz omrežja + samooskrba iz sončne = poraba, kot da elektrarne ne bi bilo.</p>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-lg p-2 text-center border border-gray-700">
                  <div className="text-[10px] text-gray-400">Uvoz (MojElektro)</div>
                  <div className="text-sm font-bold text-blue-300">{fmtKwh(blockSum)}</div>
                  <div className="text-[9px] text-gray-500">kWh</div>
                </div>
                <div className="rounded-lg p-2 text-center border border-green-700 bg-green-900/20">
                  <div className="text-[10px] text-gray-400">+ Samooskrba</div>
                  <div className="text-sm font-bold text-green-400">{fmtKwh(samooskrbaPoBlokih.reduce((a, b) => a + b, 0))}</div>
                  <div className="text-[9px] text-gray-500">kWh</div>
                </div>
                <div className="rounded-lg p-2 text-center border border-red-700 bg-red-900/20">
                  <div className="text-[10px] text-gray-400">= Brez sončne</div>
                  <div className="text-sm font-bold text-red-300">{fmtKwh(hipoSkupnaPoraba)}</div>
                  <div className="text-[9px] text-gray-500">kWh</div>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1 mb-3">
                {hipoBloki.map((v, i) => {
                  const b = i + 1;
                  const isActive = aktivniBloki.includes(b);
                  const share = hipoSkupnaPoraba > 0 ? (v / hipoSkupnaPoraba) * 100 : 0;
                  const selfB = samooskrbaPoBlokih[i];
                  // Strošek energije v bloku z DDV: energija + omrežnina bloka + prispevki + trošarina (brez fiksnih stroškov)
                  const cenaKwh = t.cena_energija_et + (hasMojelektro ? t[`cena_omreznina_blok${b}`] : t.cena_omreznina_et)
                    + t.prisp_operater_trg + t.prisp_energ_ucinkovitost + t.trosarina;
                  const strosekB = v * cenaKwh * (1 + t.ddv_stopnja);
                  return (
                    <div key={b} className={`rounded-lg p-2 text-center border ${isActive ? "border-red-700 bg-red-900/10" : "border-gray-700 opacity-50"}`}>
                      <div className="text-[8px] text-gray-400">Blok {b}</div>
                      <div className="text-xs font-bold text-red-300">{fmtKwh(v)}</div>
                      <div className="text-[8px] text-gray-500">kWh · {share.toFixed(0)} %</div>
                      <div className="h-1 rounded bg-gray-700 mt-1 overflow-hidden">
                        <div className="h-full bg-red-400" style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <div className="text-[8px] text-gray-400 mt-1">{fmtKwh(meBloki[i])} + <span className="text-green-400">{fmtKwh(selfB)}</span></div>
                      <div className="text-[10px] font-bold text-yellow-300 mt-1">{fmt(strosekB)} €</div>
                      <div className="text-[8px] text-gray-500">{(cenaKwh * (1 + t.ddv_stopnja)).toFixed(4).replace(".", ",")} €/kWh</div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between items-center rounded-lg border border-gray-700 px-3 py-2 mb-2 text-xs">
                <span className="text-gray-400">Skupaj brez sončne (z DDV, vključno s fiksnimi stroški)</span>
                <span className="font-bold text-red-300">{fmt(brezSE_skupaj)} €</span>
              </div>

              <div className="text-[10px] text-gray-500 text-center space-y-0.5">
                <div>
                  Samooskrba: {daysMeasured} dni iz meritev SolarEdge (po urah)
                  {daysEstimated > 0 && <>, {daysEstimated} dni ocena po profilu sonca</>}
                  {daysMeasured + daysEstimated === 0 && <> – ni podatkov</>}.
                </div>
                <div>Vključenih dni z meritvami MojElektro: {daysWithMe}</div>
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
