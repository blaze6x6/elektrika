"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  format, addMonths, subMonths, addYears, subYears,
  startOfMonth, endOfMonth, eachDayOfInterval,
} from "date-fns";
import { sl } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, RefreshCw, Settings,
  Download, BarChart3, ArrowLeftRight, Upload, Cloud, Calculator,
} from "lucide-react";
import { buildFormulaMap, evaluateFormula } from "@/lib/formula";
import ThemeSwitcher from "@/lib/ThemeSwitcher";
import Link from "next/link";

type ColumnConfig = { id: number; key: string; label: string; displayOrder: number; sourceType: string; formula: string | null; unit: string | null; editable: boolean; visible: boolean };
type DailyRow = { date: string; columnKey: string; value: number };

export default function DashboardClient({ isAdmin = false }: { isAdmin?: boolean }) {
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [monthData, setMonthData] = useState<DailyRow[]>([]);
  const [yearData, setYearData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<string[] | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportFrom, setExportFrom] = useState(format(startOfMonth(currentMonth), "yyyy-MM-dd"));
  const [exportTo, setExportTo] = useState(format(endOfMonth(currentMonth), "yyyy-MM-dd"));
  const [importResult, setImportResult] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<{ pv: number; load: number; grid: number; gridExporting: boolean } | null>(null);
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const touchStart = useRef<number>(0);

  const monthKey = format(currentMonth, "yyyy-MM");
  const yearKey = format(currentMonth, "yyyy");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [colRes, dataRes, yearRes] = await Promise.all([
        fetch("/api/columns"),
        fetch(`/api/data?month=${monthKey}`),
        fetch(`/api/data?year=${yearKey}`),
      ]);
      if (colRes.status === 401 || dataRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!colRes.ok || !dataRes.ok || !yearRes.ok) throw new Error("Nalaganje podatkov ni uspelo");
      setColumns((await colRes.json()).columns || []);
      setMonthData((await dataRes.json()).data || []);
      setYearData((await yearRes.json()).data || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Napaka pri nalaganju");
    } finally {
      setLoading(false);
    }
  }, [monthKey, yearKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Live data: naloži samo enkrat ob zagonu
  useEffect(() => {
    fetch("/api/solaredge/live")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setLiveData(d); })
      .catch(() => {});
  }, []);

  const buildLookup = (rows: DailyRow[]) => {
    const m: Record<string, Record<string, number>> = {};
    rows.forEach(r => { if (!m[r.date]) m[r.date] = {}; m[r.date][r.columnKey] = r.value ?? 0; });
    return m;
  };
  const monthLookup = buildLookup(monthData);
  const yearLookup = buildLookup(yearData);

  const formulaMap = buildFormulaMap(columns);

  const getCellValue = (dateStr: string, col: ColumnConfig, lookup: Record<string, Record<string, number>>): number => {
    const dayVals = lookup[dateStr] || {};
    if (col.sourceType === "formula" && col.formula) return evaluateFormula(col.formula, dayVals, formulaMap);
    return dayVals[col.key] ?? 0;
  };

  const visibleCols = columns.filter(c => c.visible);
  const daysInMonth = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });

  // Monthly totals/averages
  const monthTotals: Record<string, number> = {};
  const monthAvg: Record<string, number> = {};
  for (const col of visibleCols) {
    monthTotals[col.key] = daysInMonth.reduce((s, d) => s + getCellValue(format(d, "yyyy-MM-dd"), col, monthLookup), 0);
    monthAvg[col.key] = monthTotals[col.key] / daysInMonth.length;
  }

  // Yearly totals
  const allYearDays = eachDayOfInterval({ start: new Date(currentMonth.getFullYear(), 0, 1), end: new Date(currentMonth.getFullYear(), 11, 31) });
  const yearTotals: Record<string, number> = {};
  for (const col of visibleCols) {
    yearTotals[col.key] = allYearDays.reduce((s, d) => s + getCellValue(format(d, "yyyy-MM-dd"), col, yearLookup), 0);
  }
  const daysWithData = new Set(yearData.filter(r => (r.value ?? 0) !== 0).map(r => r.date));
  const yearDayCount = daysWithData.size || 1;
  const yearAvg: Record<string, number> = {};
  for (const col of visibleCols) yearAvg[col.key] = yearTotals[col.key] / yearDayCount;

  // Peak solar
  const solarCol = columns.find(c => c.key === "solarna" || c.key === "soncna_elektrarna");
  let peakDay = "", peakValue = 0;
  if (solarCol) for (const d of daysInMonth) {
    const v = getCellValue(format(d, "yyyy-MM-dd"), solarCol, monthLookup);
    if (v > peakValue) { peakValue = v; peakDay = format(d, "yyyy-MM-dd"); }
  }

  // Heatmap: compute min/max per column for the month
  const colStats: Record<string, { min: number; max: number }> = {};
  for (const col of visibleCols) {
    let min = Infinity, max = -Infinity;
    for (const d of daysInMonth) {
      const v = getCellValue(format(d, "yyyy-MM-dd"), col, monthLookup);
      if (v !== 0) { if (v < min) min = v; if (v > max) max = v; }
    }
    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;
    colStats[col.key] = { min, max };
  }

  const getHeatColor = (val: number, col: ColumnConfig): string => {
    if (val === 0) return "";
    const { min, max } = colStats[col.key] || { min: 0, max: 0 };
    if (max === min) return "";
    const t = (val - min) / (max - min); // 0..1
    // For visek_manjko: green=positive, red=negative
    if (col.key === "visek_manjko") {
      return val >= 0 ? `rgba(34,197,94,${0.1 + t * 0.25})` : `rgba(239,68,68,${0.1 + Math.abs(t) * 0.25})`;
    }
    // For production columns: higher=greener
    if (col.key === "solarna" || col.key === "soncna_elektrarna") {
      return `rgba(34,197,94,${0.05 + t * 0.2})`;
    }
    // For consumption: higher=redder
    return `rgba(239,68,68,${0.05 + t * 0.2})`;
  };

  // Summary cards data
  const prevMonth = subMonths(currentMonth, 1);
  const prevMonthKey = format(prevMonth, "yyyy-MM");
  const prevMonthData = yearData.filter(r => r.date.startsWith(prevMonthKey));
  const prevLookup = buildLookup(prevMonthData);
  const prevDays = eachDayOfInterval({ start: startOfMonth(prevMonth), end: endOfMonth(prevMonth) });

  const getMonthTotal = (col: ColumnConfig, days: Date[], lookup: Record<string, Record<string, number>>) =>
    days.reduce((s, d) => s + getCellValue(format(d, "yyyy-MM-dd"), col, lookup), 0);

  const summaryCol = (key: string) => visibleCols.find(c => c.key === key);
  const skupnaPoraba = summaryCol("skupna_poraba");
  const solarna = summaryCol("solarna");
  const samooskrbaCol = skupnaPoraba && solarna;

  const currentTotal = skupnaPoraba ? getMonthTotal(skupnaPoraba, daysInMonth, monthLookup) : 0;
  const prevTotal = skupnaPoraba ? getMonthTotal(skupnaPoraba, prevDays, prevLookup) : 0;
  const currentSolar = solarna ? getMonthTotal(solarna, daysInMonth, monthLookup) : 0;
  const samooskrba = currentTotal > 0 && currentSolar > 0 ? Math.min(100, (Math.min(currentSolar, currentTotal) / currentTotal) * 100) : 0;

  const handleCellChange = (dateStr: string, columnKey: string, rawValue: string) => {
    const numValue = parseFloat(rawValue.replace(",", "."));
    const finalValue = isNaN(numValue) ? 0 : numValue;
    setMonthData(prev => [...prev.filter(r => !(r.date === dateStr && r.columnKey === columnKey)), { date: dateStr, columnKey, value: finalValue }]);
    setYearData(prev => [...prev.filter(r => !(r.date === dateStr && r.columnKey === columnKey)), { date: dateStr, columnKey, value: finalValue }]);
    const tk = `${dateStr}-${columnKey}`;
    if (debounceTimers.current[tk]) clearTimeout(debounceTimers.current[tk]);
    debounceTimers.current[tk] = setTimeout(async () => {
      try {
        const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: dateStr, columnKey, value: finalValue }) });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setSaveError(`Vnos ${dateStr} (${columnKey}) ni bil shranjen: ${j.error || res.status}`);
          await fetchAll(); // vrni prikaz v skladu z bazo
        } else {
          setSaveError(null);
        }
      } catch {
        setSaveError(`Vnos ${dateStr} (${columnKey}) ni bil shranjen (ni povezave).`);
      }
    }, 500);
  };

  const handleSync = async () => {
    setSyncing(true); setSyncResults(null);
    const post = async (url: string): Promise<string[]> => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: monthKey }) });
        const json = await res.json().catch(() => ({}));
        if (json.results) return json.results as string[];
        return [`❌ ${json.error || `HTTP ${res.status}`}`];
      } catch {
        return ["❌ Ni povezave s strežnikom"];
      }
    };
    try {
      const main = await post("/api/sync");
      const me = await post("/api/sync/mojelektro");
      setSyncResults([...main, ...me.filter(r => !r.startsWith("ℹ️ MojElektro: ni nastavljen"))]);
      setLastSync(new Date().toLocaleTimeString("sl-SI"));
      await fetchAll();
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = () => { window.location.href = `/api/export?from=${exportFrom}&to=${exportTo}`; setShowExportModal(false); };
  const handlePdf = () => { window.open(`/api/report/pdf?month=${monthKey}`, "_blank"); };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult("⏳ Uvažam...");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (json.success) {
        const unk = json.unknownColumns?.length ? ` · neprepoznani stolpci: ${json.unknownColumns.join(", ")}` : "";
        setImportResult(`✅ Uvoženo: ${json.imported} vrednosti, ${json.skipped} preskočenih${unk}`);
        await fetchAll();
      } else {
        setImportResult(`❌ ${json.error || `HTTP ${res.status}`}`);
      }
    } catch {
      setImportResult("❌ Uvoz ni uspel (ni povezave)");
    }
    e.target.value = ""; // omogoči ponovni izbor iste datoteke
  };

  // Swipe – samo na navigacijski vrstici spodaj
  const onNavTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX;
  };
  const onNavTouchEnd = (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientX - touchStart.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setCurrentMonth(subMonths(currentMonth, 1));
      else setCurrentMonth(addMonths(currentMonth, 1));
    }
  };

  const formatNum = (n: number, d = 1) => n === 0 ? "0" : n.toFixed(d).replace(".", ",");

  // Kratka imena za mobilni prikaz
  const SHORT_LABELS: Record<string, string> = {
    visek_manjko: "+/−",
    gospodinjstvo: "Gosp.",
    toplotna_ogrevanje: "Ogrev.",
    toplotna_sanitarna: "San.v.",
    skupna_poraba: "Sk.por.",
    solarna: "Solar.",
    toplotna: "Topl.",
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-gray-200 text-xs sm:text-sm">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-2 py-1.5 gap-1 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 px-2 py-1.5 rounded text-white font-semibold text-[11px] disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "..." : "Sync"}
          </button>
          <button onClick={() => setShowExportModal(true)} className="flex items-center gap-1 bg-green-700 hover:bg-green-600 px-2 py-1.5 rounded text-white font-semibold text-[11px]">
            <Download size={12} /> Izvoz
          </button>
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-1 bg-yellow-700 hover:bg-yellow-600 px-2 py-1.5 rounded text-white font-semibold text-[11px]">
            <Upload size={12} /> Uvoz
          </button>
          <Link href="/charts" className="flex items-center gap-1 bg-purple-700 hover:bg-purple-600 px-2 py-1.5 rounded text-white font-semibold text-[11px]">
            <BarChart3 size={12} /> Grafi
          </Link>
          <Link href="/compare" className="flex items-center gap-1 bg-cyan-700 hover:bg-cyan-600 px-2 py-1.5 rounded text-white font-semibold text-[11px]">
            <ArrowLeftRight size={12} /> Leta
          </Link>
          <Link href="/calculator" className="flex items-center gap-1 bg-orange-700 hover:bg-orange-600 px-2 py-1.5 rounded text-white font-semibold text-[11px]">
            <Calculator size={12} /> €
          </Link>
        </div>
        <div className="flex gap-1">
          <ThemeSwitcher />
          {isAdmin && (
            <Link href="/admin" className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 px-2 py-1.5 rounded text-white text-[11px]">
              <Settings size={12} /> Admin
            </Link>
          )}
        </div>
      </div>

      {(saveError || loadError) && (
        <div className="mx-2 mb-1 p-2 bg-red-900/60 border border-red-700 rounded text-xs text-red-200 flex justify-between gap-2">
          <span>{saveError || loadError}</span>
          <button onClick={() => { setSaveError(null); setLoadError(null); }} className="text-red-300">✕</button>
        </div>
      )}

      {/* Last sync */}
      {lastSync && <div className="mx-2 mb-1 text-[10px] text-gray-500 flex items-center gap-1"><Cloud size={10} /> Zadnji sync: {lastSync}</div>}

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-3 gap-1.5 mx-2 mb-2">
          <div className="bg-gray-800 rounded-lg p-2 text-center">
            <div className="text-[9px] text-gray-400">Poraba</div>
            <div className="text-sm font-bold text-yellow-400">{formatNum(currentTotal, 0)}</div>
            <div className={`text-[9px] ${currentTotal > prevTotal ? "text-red-400" : "text-green-400"}`}>
              {prevTotal > 0 ? `${currentTotal > prevTotal ? "+" : ""}${formatNum(currentTotal - prevTotal, 0)} kWh` : ""}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-2 text-center">
            <div className="text-[9px] text-gray-400">Proizvodnja</div>
            <div className="text-sm font-bold text-green-400">{formatNum(currentSolar, 0)}</div>
            <div className="text-[9px] text-gray-500">kWh</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-2 text-center">
            <div className="text-[9px] text-gray-400">Samooskrba</div>
            <div className={`text-sm font-bold ${samooskrba > 70 ? "text-green-400" : samooskrba > 40 ? "text-yellow-400" : "text-red-400"}`}>{samooskrba.toFixed(0)}%</div>
          </div>
        </div>
      )}

      {/* Sync/Import results */}
      {syncResults && (
        <div className="mx-2 mb-1 p-2 bg-gray-800 border border-gray-600 rounded text-xs space-y-0.5 max-h-32 overflow-y-auto">
          <div className="flex justify-between"><span className="font-bold text-gray-300">Rezultati:</span><button onClick={() => setSyncResults(null)} className="text-gray-500">✕</button></div>
          {syncResults.map((r, i) => <div key={i} className={r.startsWith("✅") ? "text-green-400" : r.startsWith("❌") ? "text-red-400" : r.startsWith("ℹ️") ? "text-gray-300" : "text-yellow-400"}>{r}</div>)}
        </div>
      )}

      {/* Live Data Dashboard */}
      {liveData && (
        <div className="mx-2 mb-2 grid grid-cols-3 gap-1">
          <div className="bg-green-900/20 border border-green-800/40 rounded-lg p-2 text-center relative overflow-hidden">
            <div className="text-[8px] text-green-400 uppercase font-bold mb-1 flex items-center justify-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
              </span>
              Sonce
            </div>
            <div className="text-sm font-black text-green-300">{liveData.pv.toFixed(2)} <span className="text-[10px] font-normal">kW</span></div>
          </div>
          <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-2 text-center">
            <div className="text-[8px] text-blue-400 uppercase font-bold mb-1">Hiša</div>
            <div className="text-sm font-black text-blue-300">{liveData.load.toFixed(2)} <span className="text-[10px] font-normal">kW</span></div>
          </div>
          <div className={`rounded-lg p-2 text-center border ${liveData.gridExporting ? "bg-green-900/20 border-green-800/40" : "bg-red-900/20 border-red-800/40"}`}>
            <div className={`text-[8px] uppercase font-bold mb-1 ${liveData.gridExporting ? "text-green-400" : "text-red-400"}`}>Omrežje</div>
            <div className="text-sm font-black">
              <span className={liveData.gridExporting ? "text-green-300" : "text-red-300"}>
                {liveData.grid.toFixed(2)}
                <span className="text-[10px] font-normal ml-0.5">kW {liveData.gridExporting ? "↑" : "↓"}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Peak */}
      {peakDay && peakValue > 0 && (
        <div className="mx-2 mb-2 px-3 py-1.5 bg-yellow-900/20 border border-yellow-700/30 rounded-lg text-yellow-300 text-[10px] flex items-center justify-between">
          <span>📅 Največja dnevna proizvodnja v mesecu:</span>
          <strong>{format(new Date(peakDay + "T12:00:00"), "d. M. yyyy")} — {formatNum(peakValue, 2)} kWh</strong>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-lg font-bold mb-4">Izvoz CSV</h2>
            <div className="space-y-4">
              <div><label className="block text-xs text-gray-400 mb-1">Od</label><input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-sm text-white" /></div>
              <div><label className="block text-xs text-gray-400 mb-1">Do</label><input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-sm text-white" /></div>
              <div className="flex gap-2">
                <button onClick={handleExport} className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded font-bold text-white text-sm">CSV</button>
                <button onClick={handlePdf} className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold text-white text-sm">PDF</button>
                <button onClick={() => setShowExportModal(false)} className="flex-1 bg-gray-600 py-2 rounded text-white text-sm">Zapri</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-lg font-bold mb-2">Uvoz iz CSV</h2>
            <p className="text-xs text-gray-400 mb-4">Prva vrstica: <code className="bg-gray-700 px-1 rounded">datum;kljuc_stolpca1;kljuc_stolpca2;...</code><br/>Datum: <code className="bg-gray-700 px-1 rounded">1.7.2026</code> ali <code className="bg-gray-700 px-1 rounded">2026-07-01</code></p>
            <input type="file" accept=".csv,.txt,.tsv" onChange={handleImport} className="w-full text-sm mb-3 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white file:font-semibold file:cursor-pointer" />
            {importResult && <div className={`p-2 rounded text-xs mb-3 ${importResult.startsWith("✅") ? "bg-green-900/30 text-green-400" : importResult.startsWith("❌") ? "bg-red-900/30 text-red-400" : "bg-blue-900/30 text-blue-300"}`}>{importResult}</div>}
            <button onClick={() => { setShowImportModal(false); setImportResult(null); }} className="w-full bg-gray-600 py-2 rounded text-white text-sm">Zapri</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto pb-20">
        <table className="w-full border-separate border-spacing-0 text-[9px] sm:text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-40 border border-gray-700 bg-gray-800 px-1 py-1 text-center shadow-[0_2px_0_rgba(55,65,81,1)]">
                <span className="sm:hidden text-[8px] font-bold">Dat.</span>
                <span className="hidden sm:inline text-[10px] font-bold">Datum</span>
              </th>
              {visibleCols.map(col => (
                <th key={col.key} className="sticky top-0 z-30 border border-gray-700 bg-gray-800 px-0.5 py-1 text-center shadow-[0_2px_0_rgba(55,65,81,1)]">
                  <span className="block font-bold text-[8px] leading-tight sm:hidden">{SHORT_LABELS[col.key] || col.label}</span>
                  <span className="hidden sm:block font-bold text-[10px] leading-tight">{col.label}</span>
                  <span className="block text-gray-500 text-[7px] sm:text-[8px] hidden sm:block">({col.unit})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleCols.length + 1} className="text-center p-8 text-gray-500">Nalaganje...</td></tr>
            ) : (<>
              {daysInMonth.map(day => {
                const dateStr = format(day, "yyyy-MM-dd");
                return (
                  <tr key={dateStr} className="hover:bg-gray-900/60 border-b border-gray-800/60">
                    <td className="px-1 py-0.5 border border-gray-700 font-medium text-center sticky left-0 bg-gray-950 z-10 whitespace-nowrap">
                      <span className="sm:hidden">{format(day, "d.M.")}</span>
                      <span className="hidden sm:inline">{format(day, "d.M.yyyy")}</span>
                    </td>
                    {visibleCols.map(col => {
                      const val = getCellValue(dateStr, col, monthLookup);
                      const isFormula = col.sourceType === "formula";
                      const isEditable = col.editable && !isFormula;
                      const bg = getHeatColor(val, col);

                      if (isEditable) return (
                        <td key={col.key} className="border border-gray-700 p-0" style={{ backgroundColor: bg }}>
                          <input type="text" inputMode="decimal" defaultValue={val !== 0 ? String(val).replace(".", ",") : ""} key={`${dateStr}-${col.key}-${val}`}
                            onBlur={e => handleCellChange(dateStr, col.key, e.target.value)}
                            className="w-full bg-transparent text-right px-1 py-0.5 outline-none focus:bg-gray-800" />
                        </td>
                      );
                      return (
                        <td key={col.key} className={`px-1 py-0.5 border border-gray-700 text-right ${val < 0 ? "text-red-400" : val > 0 ? "text-gray-300" : "text-gray-700"}`} style={{ backgroundColor: bg }}>
                          {val !== 0 ? formatNum(val, 2) : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Monthly total */}
              <tr className="bg-gray-800 font-bold border-t-2 border-green-800">
                <td className="px-1 py-0.5 border border-gray-700 sticky left-0 bg-gray-800 z-10 text-green-400 text-[8px] sm:text-xs">
                  <span className="sm:hidden">∑ Mes.</span>
                  <span className="hidden sm:inline">SKUPAJ</span>
                </td>
                {visibleCols.map(col => <td key={col.key} className={`px-1 py-0.5 border border-gray-700 text-right ${(monthTotals[col.key] || 0) < 0 ? "text-red-400" : "text-green-400"}`}>{formatNum(monthTotals[col.key] || 0, 2)}</td>)}
              </tr>
              <tr className="bg-gray-800/80 text-gray-400">
                <td className="px-1 py-0.5 border border-gray-700 sticky left-0 bg-gray-800/80 z-10 text-[8px] sm:text-[10px]">
                  <span className="sm:hidden">Ø Dan</span>
                  <span className="hidden sm:inline">Povprečje/dan</span>
                </td>
                {visibleCols.map(col => <td key={col.key} className="px-1 py-0.5 border border-gray-700 text-right">{formatNum(monthAvg[col.key] || 0, 2)}</td>)}
              </tr>
              <tr className="bg-blue-900/30 font-bold border-t-2 border-blue-800">
                <td className="px-1 py-0.5 border border-gray-700 sticky left-0 bg-blue-950/60 z-10 text-blue-400 text-[8px] sm:text-xs">
                  <span className="sm:hidden">∑ Leto</span>
                  <span className="hidden sm:inline">Leto {yearKey}</span>
                </td>
                {visibleCols.map(col => <td key={col.key} className={`px-1 py-0.5 border border-gray-700 text-right ${(yearTotals[col.key] || 0) < 0 ? "text-red-400" : "text-blue-400"}`}>{formatNum(yearTotals[col.key] || 0, 2)}</td>)}
              </tr>
              <tr className="bg-blue-900/20 text-gray-400">
                <td className="px-1 py-0.5 border border-gray-700 sticky left-0 bg-blue-950/40 z-10 text-[8px] sm:text-[10px]">
                  <span className="sm:hidden">Ø Leto</span>
                  <span className="hidden sm:inline">Povp. leto/dan</span>
                </td>
                {visibleCols.map(col => <td key={col.key} className="px-1 py-0.5 border border-gray-700 text-right">{formatNum(yearAvg[col.key] || 0, 2)}</td>)}
              </tr>
            </>)}
          </tbody>
        </table>
      </div>

      {/* Bottom nav – swipe samo tukaj */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.5)] select-none"
        onTouchStart={onNavTouchStart}
        onTouchEnd={onNavTouchEnd}
      >
        <div className="flex items-center justify-center gap-3 pt-1.5 pb-0.5 relative">
          <button onClick={() => setCurrentMonth(subYears(currentMonth, 1))} className="px-2 py-0.5 text-gray-500 hover:text-white text-xs flex items-center gap-1"><ChevronLeft size={12} />{format(subYears(currentMonth, 1), "yyyy")}</button>
          
          <div className="flex items-center gap-2">
            <span className="text-gray-300 font-bold text-sm">{yearKey}</span>
            {format(currentMonth, "yyyy-MM") !== format(new Date(), "yyyy-MM") && (
              <button 
                onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
                className="px-2 py-0.5 bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] rounded font-bold transition-all"
              >
                Danes
              </button>
            )}
          </div>

          <button onClick={() => setCurrentMonth(addYears(currentMonth, 1))} className="px-2 py-0.5 text-gray-500 hover:text-white text-xs flex items-center gap-1">{format(addYears(currentMonth, 1), "yyyy")}<ChevronRight size={12} /></button>
        </div>
        <div className="flex items-center justify-center gap-1 pb-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronLeft size={16} /></button>
          {[-1, 0, 1].map(offset => {
            const m = addMonths(currentMonth, offset);
            return <button key={offset} onClick={() => setCurrentMonth(m)} className={`px-3 py-1 rounded-full capitalize text-xs ${offset === 0 ? "bg-green-600 text-white font-bold" : "text-gray-400 hover:text-white"}`}>{format(m, "MMM yyyy", { locale: sl })}</button>;
          })}
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
