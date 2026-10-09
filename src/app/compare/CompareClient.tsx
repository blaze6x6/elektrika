"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buildFormulaMap, evaluateFormula } from "@/lib/formula";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";
import { useTheme } from "@/lib/ThemeContext";
import { chartColors } from "@/lib/themes";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type ColumnConfig = { id: number; key: string; label: string; displayOrder: number; sourceType: string; formula: string | null; unit: string | null; editable: boolean; visible: boolean };
type DailyRow = { date: string; columnKey: string; value: number };

const MONTH_NAMES = ["Januar", "Februar", "Marec", "April", "Maj", "Junij", "Julij", "Avgust", "September", "Oktober", "November", "December"];

export default function CompareClient() {
  const { isLight } = useTheme();
  const thisYear = new Date().getFullYear();
  const [yearA, setYearA] = useState(thisYear - 1);
  const [yearB, setYearB] = useState(thisYear);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [dataA, setDataA] = useState<DailyRow[]>([]);
  const [dataB, setDataB] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCol, setSelectedCol] = useState("skupna_poraba");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [colRes, resA, resB] = await Promise.all([
      fetch("/api/columns"),
      fetch(`/api/data?year=${yearA}`),
      fetch(`/api/data?year=${yearB}`),
    ]);
    setColumns((await colRes.json()).columns || []);
    setDataA((await resA.json()).data || []);
    setDataB((await resB.json()).data || []);
    setLoading(false);
  }, [yearA, yearB]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const formulaMap = buildFormulaMap(columns);
  const visibleCols = columns.filter(c => c.visible);
  const col = visibleCols.find(c => c.key === selectedCol) || visibleCols[0];

  const calcMonthTotal = (data: DailyRow[], year: number, month: number, column: ColumnConfig): number => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const lookup: Record<string, Record<string, number>> = {};
    data.filter(r => r.date.startsWith(prefix)).forEach(r => {
      if (!lookup[r.date]) lookup[r.date] = {};
      lookup[r.date][r.columnKey] = r.value ?? 0;
    });
    let total = 0;
    for (const dayVals of Object.values(lookup)) {
      if (column.sourceType === "formula" && column.formula) {
        total += evaluateFormula(column.formula, dayVals, formulaMap);
      } else {
        total += dayVals[column.key] ?? 0;
      }
    }
    return total;
  };

  const calcYearTotal = (data: DailyRow[], year: number, column: ColumnConfig): number => {
    let total = 0;
    for (let m = 0; m < 12; m++) total += calcMonthTotal(data, year, m, column);
    return total;
  };

  const fmt = (n: number) => n === 0 ? "-" : n.toFixed(1).replace(".", ",");

  // Chart data
  const chartDataA = MONTH_NAMES.map((_, m) => col ? calcMonthTotal(dataA, yearA, m, col) : 0);
  const chartDataB = MONTH_NAMES.map((_, m) => col ? calcMonthTotal(dataB, yearB, m, col) : 0);
  const chartData = {
    labels: MONTH_NAMES.map(n => n.substring(0, 3)),
    datasets: [
      { label: String(yearA), data: chartDataA, backgroundColor: "rgba(59,130,246,0.6)", borderColor: "#3b82f6", borderWidth: 1 },
      { label: String(yearB), data: chartDataB, backgroundColor: "rgba(34,197,94,0.6)", borderColor: "#22c55e", borderWidth: 1 },
    ],
  };
  const { axis: axisColor, legend: legendColor, grid: gridColor } = chartColors(isLight);
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: legendColor } } },
    scales: { x: { ticks: { color: axisColor }, grid: { color: gridColor } }, y: { ticks: { color: axisColor }, grid: { color: gridColor }, title: { display: true, text: "kWh", color: axisColor } } },
  };
  const diff = (a: number, b: number) => {
    if (a === 0 && b === 0) return { text: "-", cls: "text-gray-500" };
    const d = b - a;
    const pct = a !== 0 ? ((d / a) * 100).toFixed(0) : "∞";
    if (d > 0) return { text: `+${d.toFixed(1).replace(".", ",")} (${pct}%)`, cls: "text-red-400" };
    if (d < 0) return { text: `${d.toFixed(1).replace(".", ",")} (${pct}%)`, cls: "text-green-400" };
    return { text: "0", cls: "text-gray-500" };
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">Primerjava let</h1>
        <ThemeSwitcher className="ml-auto" />
      </header>

      <main className="p-3 max-w-3xl mx-auto space-y-4">
        {/* Year selectors */}
        <div className="flex items-center justify-center gap-6">
          <div className="flex items-center gap-2">
            <button onClick={() => setYearA(yearA - 1)} className="p-1 bg-gray-800 rounded hover:bg-gray-700"><ChevronLeft size={16} /></button>
            <span className="font-bold text-blue-400 text-lg w-16 text-center">{yearA}</span>
            <button onClick={() => setYearA(yearA + 1)} className="p-1 bg-gray-800 rounded hover:bg-gray-700"><ChevronRight size={16} /></button>
          </div>
          <span className="text-gray-500 font-bold">vs</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setYearB(yearB - 1)} className="p-1 bg-gray-800 rounded hover:bg-gray-700"><ChevronLeft size={16} /></button>
            <span className="font-bold text-green-400 text-lg w-16 text-center">{yearB}</span>
            <button onClick={() => setYearB(yearB + 1)} className="p-1 bg-gray-800 rounded hover:bg-gray-700"><ChevronRight size={16} /></button>
          </div>
        </div>

        {/* Column selector */}
        <div className="flex flex-wrap gap-1.5 justify-center">
          {visibleCols.map(c => (
            <button
              key={c.key}
              onClick={() => setSelectedCol(c.key)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${selectedCol === c.key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Yearly chart */}
        {!loading && col && (
          <div className="bg-gray-800 rounded-xl p-4" style={{ height: "280px" }}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Nalaganje...</div>
        ) : col && (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-gray-800">
                  <th className="sticky left-0 bg-gray-800 p-2 border border-gray-700 text-left z-10">Mesec</th>
                  <th className="p-2 border border-gray-700 text-right text-blue-400">{yearA}</th>
                  <th className="p-2 border border-gray-700 text-right text-green-400">{yearB}</th>
                  <th className="p-2 border border-gray-700 text-right">Razlika</th>
                </tr>
              </thead>
              <tbody>
                {MONTH_NAMES.map((name, m) => {
                  const valA = calcMonthTotal(dataA, yearA, m, col);
                  const valB = calcMonthTotal(dataB, yearB, m, col);
                  const d = diff(valA, valB);
                  return (
                    <tr key={m} className="hover:bg-gray-800/50">
                      <td className="sticky left-0 bg-gray-950 p-2 border border-gray-700 font-medium z-10">{name}</td>
                      <td className="p-2 border border-gray-700 text-right text-blue-300">{fmt(valA)}</td>
                      <td className="p-2 border border-gray-700 text-right text-green-300">{fmt(valB)}</td>
                      <td className={`p-2 border border-gray-700 text-right text-xs ${d.cls}`}>{d.text}</td>
                    </tr>
                  );
                })}
                {/* Yearly total */}
                <tr className="bg-gray-800 font-bold border-t-2 border-gray-600">
                  <td className="sticky left-0 bg-gray-800 p-2 border border-gray-700 z-10">SKUPAJ</td>
                  <td className="p-2 border border-gray-700 text-right text-blue-400">{fmt(calcYearTotal(dataA, yearA, col))}</td>
                  <td className="p-2 border border-gray-700 text-right text-green-400">{fmt(calcYearTotal(dataB, yearB, col))}</td>
                  <td className={`p-2 border border-gray-700 text-right text-xs ${diff(calcYearTotal(dataA, yearA, col), calcYearTotal(dataB, yearB, col)).cls}`}>
                    {diff(calcYearTotal(dataA, yearA, col), calcYearTotal(dataB, yearB, col)).text}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
