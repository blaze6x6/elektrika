"use client";

import { useState, useEffect, useCallback } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { sl } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { evaluateFormula } from "@/lib/formula";
import { useTheme } from "@/lib/ThemeContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

type ColumnConfig = { id: number; key: string; label: string; displayOrder: number; sourceType: string; formula: string | null; unit: string | null; editable: boolean; visible: boolean };
type DailyRow = { date: string; columnKey: string; value: number };

const COLORS: Record<string, string> = {
  toplotna: "#ef4444",
  toplotna_ogrevanje: "#f97316",
  toplotna_sanitarna: "#fb923c",
  avto: "#a855f7",
  gospodinjstvo: "#3b82f6",
  solarna: "#22c55e",
  skupna_poraba: "#eab308",
  visek_manjko: "#06b6d4",
};

const BG_COLORS: Record<string, string> = {
  toplotna: "rgba(239,68,68,0.3)",
  toplotna_ogrevanje: "rgba(249,115,22,0.3)",
  toplotna_sanitarna: "rgba(251,146,60,0.3)",
  avto: "rgba(168,85,247,0.3)",
  gospodinjstvo: "rgba(59,130,246,0.3)",
  solarna: "rgba(34,197,94,0.3)",
  skupna_poraba: "rgba(234,179,8,0.3)",
  visek_manjko: "rgba(6,182,212,0.3)",
};

export default function ChartsClient() {
  const { theme } = useTheme();
  const [currentMonth, setCurrentMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [monthData, setMonthData] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"bar" | "line">("bar");
  const [selectedCols, setSelectedCols] = useState<string[]>(["solarna", "skupna_poraba", "visek_manjko"]);

  const monthKey = format(currentMonth, "yyyy-MM");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [colRes, dataRes] = await Promise.all([
      fetch("/api/columns"),
      fetch(`/api/data?month=${monthKey}`),
    ]);
    const colJson = await colRes.json();
    const dataJson = await dataRes.json();
    setColumns(colJson.columns || []);
    setMonthData(dataJson.data || []);
    setLoading(false);
  }, [monthKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const visibleCols = columns.filter(c => c.visible);
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const labels = days.map(d => format(d, "d."));

  const lookup: Record<string, Record<string, number>> = {};
  monthData.forEach(r => { if (!lookup[r.date]) lookup[r.date] = {}; lookup[r.date][r.columnKey] = r.value ?? 0; });

  const getCellValue = (dateStr: string, col: ColumnConfig): number => {
    const dayVals = lookup[dateStr] || {};
    if (col.sourceType === "formula" && col.formula) return evaluateFormula(col.formula, dayVals);
    return dayVals[col.key] ?? 0;
  };

  const toggleCol = (key: string) => {
    setSelectedCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const datasets = visibleCols
    .filter(c => selectedCols.includes(c.key))
    .map(col => ({
      label: col.label,
      data: days.map(d => getCellValue(format(d, "yyyy-MM-dd"), col)),
      backgroundColor: BG_COLORS[col.key] || "rgba(156,163,175,0.3)",
      borderColor: COLORS[col.key] || "#9ca3af",
      borderWidth: 2,
      tension: 0.3,
      fill: chartType === "line",
      pointRadius: chartType === "line" ? 3 : 0,
    }));

  const axisColor = theme === "light" ? "#374151" : "#9ca3af";
  const legendColor = theme === "light" ? "#111827" : "#d1d5db";
  const gridColor = theme === "light" ? "rgba(209,213,219,0.8)" : "rgba(75,85,99,0.3)";

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: legendColor, font: { size: 11 } } },
      tooltip: { mode: "index" as const, intersect: false },
    },
    scales: {
      x: { ticks: { color: axisColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: axisColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: "kWh", color: axisColor } },
    },
  };

  const ChartComponent = chartType === "bar" ? Bar : Line;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">Grafi</h1>
      </header>

      <main className="p-3 max-w-5xl mx-auto space-y-4">
        {/* Month nav */}
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronLeft size={18} /></button>
          <span className="text-lg font-bold capitalize">{format(currentMonth, "MMMM yyyy", { locale: sl })}</span>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700"><ChevronRight size={18} /></button>
        </div>

        {/* Chart type + column toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setChartType("bar")} className={`px-3 py-1 rounded text-xs font-bold ${chartType === "bar" ? "bg-blue-600" : "bg-gray-700"}`}>Stolpični</button>
          <button onClick={() => setChartType("line")} className={`px-3 py-1 rounded text-xs font-bold ${chartType === "line" ? "bg-blue-600" : "bg-gray-700"}`}>Linijski</button>
          <span className="text-gray-500 text-xs ml-2">|</span>
          {visibleCols.map(col => (
            <button
              key={col.key}
              onClick={() => toggleCol(col.key)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${selectedCols.includes(col.key) ? "border-current opacity-100" : "border-gray-600 opacity-40"}`}
              style={{ color: COLORS[col.key] || "#9ca3af" }}
            >
              {col.label}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="bg-gray-800 rounded-xl p-4" style={{ height: "400px" }}>
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-500">Nalaganje...</div>
          ) : (
            <ChartComponent data={{ labels, datasets }} options={options} />
          )}
        </div>

        {/* Summary cards */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {visibleCols.filter(c => selectedCols.includes(c.key)).map(col => {
              const total = days.reduce((s, d) => s + getCellValue(format(d, "yyyy-MM-dd"), col), 0);
              const avg = total / days.length;
              return (
                <div key={col.key} className="bg-gray-800 rounded-lg p-3 border-l-4" style={{ borderColor: COLORS[col.key] || "#6b7280" }}>
                  <div className="text-[10px] text-gray-400">{col.label}</div>
                  <div className="text-lg font-bold" style={{ color: COLORS[col.key] || "#d1d5db" }}>{total.toFixed(1)}</div>
                  <div className="text-[10px] text-gray-500">Ø {avg.toFixed(2)} /dan</div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
