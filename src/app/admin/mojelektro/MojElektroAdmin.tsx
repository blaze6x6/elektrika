"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

const TYPES = [
  { key: "merilno-mesto", label: "Merilno mesto" },
  { key: "merilna-tocka", label: "Merilna točka" },
  { key: "reading-type", label: "Reading types" },
  { key: "reading-qualities", label: "Reading qualities" },
];

export default function MojElektroAdmin() {
  const [selected, setSelected] = useState("merilno-mesto");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sync/mojelektro?type=${selected}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Napaka");
        setResult(null);
      } else {
        setResult(json.data ?? json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Napaka");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">MojElektro diagnostika</h1>
      </header>

      <main className="p-4 max-w-4xl mx-auto space-y-4">
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-sm text-gray-400">
            Tukaj lahko preveriš, kaj MojElektro API dejansko vrača za tvoje merilno mesto in merilno točko.
            To je uporabno za dokončno avtomatizacijo kalkulatorja.
          </p>
          <div className="flex flex-wrap gap-2">
            {TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => setSelected(t.key)}
                className={`px-3 py-1.5 rounded text-sm ${selected === t.key ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={load}
              disabled={loading}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Nalagam..." : "Preveri API"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            ❌ {error}
          </div>
        )}

        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-sm font-semibold mb-3">Rezultat: {TYPES.find(t => t.key === selected)?.label}</div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-auto max-h-[70vh] bg-gray-950 rounded-lg p-4 border border-gray-700">
            {result ? JSON.stringify(result, null, 2) : "Še ni naloženega odgovora."}
          </pre>
        </div>
      </main>
    </div>
  );
}
