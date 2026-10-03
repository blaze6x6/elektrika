"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Save } from "lucide-react";

type ColumnConfig = {
  id: number;
  key: string;
  label: string;
  displayOrder: number;
  sourceType: string;
  formula: string | null;
  unit: string | null;
  editable: boolean;
  visible: boolean;
};

export default function ColumnsAdmin() {
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // New column form
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSourceType, setNewSourceType] = useState("manual");
  const [newFormula, setNewFormula] = useState("");
  const [newUnit, setNewUnit] = useState("kWh");

  // Edit form
  const [editLabel, setEditLabel] = useState("");
  const [editSourceType, setEditSourceType] = useState("");
  const [editFormula, setEditFormula] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editEditable, setEditEditable] = useState(true);

  useEffect(() => {
    fetchColumns();
  }, []);

  const fetchColumns = async () => {
    setLoading(true);
    const res = await fetch("/api/columns");
    const json = await res.json();
    setColumns(json.columns || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newKey || !newLabel) return;
    await fetch("/api/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: newKey.toLowerCase().replace(/\s+/g, "_"),
        label: newLabel,
        sourceType: newSourceType,
        formula: newSourceType === "formula" ? newFormula : null,
        unit: newUnit,
        editable: newSourceType !== "formula",
        displayOrder: columns.length,
      }),
    });
    setNewKey("");
    setNewLabel("");
    setNewFormula("");
    setShowAdd(false);
    await fetchColumns();
  };

  const handleStartEdit = (col: ColumnConfig) => {
    setEditing(col.id);
    setEditLabel(col.label);
    setEditSourceType(col.sourceType);
    setEditFormula(col.formula || "");
    setEditUnit(col.unit || "kWh");
    setEditEditable(col.editable);
  };

  const handleSaveEdit = async (id: number) => {
    await fetch("/api/columns", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        label: editLabel,
        sourceType: editSourceType,
        formula: editSourceType === "formula" ? editFormula : null,
        unit: editUnit,
        editable: editSourceType !== "formula" ? editEditable : false,
      }),
    });
    setEditing(null);
    await fetchColumns();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Ali ste prepričani, da želite izbrisati ta stolpec?")) return;
    await fetch(`/api/columns?id=${id}`, { method: "DELETE" });
    await fetchColumns();
  };

  const handleMove = async (col: ColumnConfig, direction: "up" | "down") => {
    const idx = columns.findIndex((c) => c.id === col.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= columns.length) return;

    const other = columns[swapIdx];
    await Promise.all([
      fetch("/api/columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: col.id, displayOrder: other.displayOrder }),
      }),
      fetch("/api/columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: other.id, displayOrder: col.displayOrder }),
      }),
    ]);
    await fetchColumns();
  };

  const sourceTypeLabel = (s: string) => {
    switch (s) {
      case "manual": return "Ročno";
      case "solaredge": return "SolarEdge";
      case "melcloud": return "MELCloud";
      case "formula": return "Formula";
      default: return s;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Upravljanje stolpcev</h1>
      </header>

      <main className="p-4 max-w-3xl mx-auto">
        {/* Info */}
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 mb-4 text-xs text-blue-300">
          <p className="font-bold mb-1">Kako delajo formule:</p>
          <p>Uporabite <code className="bg-blue-900 px-1 rounded">{"{"}</code>kljuc_stolpca<code className="bg-blue-900 px-1 rounded">{"}"}</code> za sklicevanje na drug stolpec.</p>
          <p className="mt-1">Primer: <code className="bg-blue-900 px-1 rounded">{"{toplotna_ogrevanje} + {toplotna_sanitarna}"}</code></p>
          <p className="mt-1">Podprti operatorji: <code className="bg-blue-900 px-1 rounded">+ - * /</code></p>
        </div>

        {/* Add button */}
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="mb-4 flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-white font-semibold text-sm"
          >
            <Plus size={16} /> Dodaj stolpec
          </button>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="bg-gray-800 rounded-lg p-4 mb-4 space-y-3">
            <h3 className="font-bold text-sm">Nov stolpec</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Ključ (brez presledkov)</label>
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                  placeholder="npr. toplotna_ogrevanje"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Oznaka</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                  placeholder="npr. Toplotna ogrevanje"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Vir podatkov</label>
                <select
                  value={newSourceType}
                  onChange={(e) => setNewSourceType(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                >
                  <option value="manual">Ročno</option>
                  <option value="solaredge">SolarEdge</option>
                  <option value="melcloud">MELCloud</option>
                  <option value="formula">Formula (izračun)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Enota</label>
                <input
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                />
              </div>
            </div>
            {newSourceType === "formula" && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Formula</label>
                <input
                  value={newFormula}
                  onChange={(e) => setNewFormula(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm font-mono"
                  placeholder="{stolpec_a} + {stolpec_b}"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm font-semibold"
              >
                Shrani
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-sm"
              >
                Prekliči
              </button>
            </div>
          </div>
        )}

        {/* Column list */}
        {loading ? (
          <p className="text-gray-500">Nalaganje...</p>
        ) : (
          <div className="space-y-2">
            {columns.map((col, idx) => (
              <div key={col.id} className="bg-gray-800 rounded-lg p-4">
                {editing === col.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Ključ</label>
                        <input value={col.key} disabled className="w-full bg-gray-600 px-3 py-2 rounded text-sm text-gray-400" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Oznaka</label>
                        <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full bg-gray-700 px-3 py-2 rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Vir podatkov</label>
                        <select value={editSourceType} onChange={(e) => setEditSourceType(e.target.value)} className="w-full bg-gray-700 px-3 py-2 rounded text-sm">
                          <option value="manual">Ročno</option>
                          <option value="solaredge">SolarEdge</option>
                          <option value="melcloud">MELCloud</option>
                          <option value="formula">Formula</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Enota</label>
                        <input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className="w-full bg-gray-700 px-3 py-2 rounded text-sm" />
                      </div>
                    </div>
                    {editSourceType === "formula" && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Formula</label>
                        <input value={editFormula} onChange={(e) => setEditFormula(e.target.value)} className="w-full bg-gray-700 px-3 py-2 rounded text-sm font-mono" />
                      </div>
                    )}
                    {editSourceType !== "formula" && (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editEditable} onChange={(e) => setEditEditable(e.target.checked)} className="rounded" />
                        Ročno urejanje omogočeno
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveEdit(col.id)} className="flex items-center gap-1 bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm"><Save size={14} /> Shrani</button>
                      <button onClick={() => setEditing(null)} className="bg-gray-600 hover:bg-gray-500 px-3 py-1.5 rounded text-sm">Prekliči</button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{col.label}</span>
                        <span className="text-xs bg-gray-700 px-2 py-0.5 rounded font-mono text-gray-400">{col.key}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          col.sourceType === "formula" ? "bg-purple-900 text-purple-300" :
                          col.sourceType === "solaredge" ? "bg-orange-900 text-orange-300" :
                          col.sourceType === "melcloud" ? "bg-cyan-900 text-cyan-300" :
                          "bg-gray-700 text-gray-400"
                        }`}>
                          {sourceTypeLabel(col.sourceType)}
                        </span>
                      </div>
                      {col.formula && (
                        <p className="text-xs text-purple-400 font-mono mt-1">= {col.formula}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleMove(col, "up")} disabled={idx === 0} className="p-1 hover:bg-gray-700 rounded disabled:opacity-30"><ChevronUp size={16} /></button>
                      <button onClick={() => handleMove(col, "down")} disabled={idx === columns.length - 1} className="p-1 hover:bg-gray-700 rounded disabled:opacity-30"><ChevronDown size={16} /></button>
                      <button onClick={() => handleStartEdit(col)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">Uredi</button>
                      <button onClick={() => handleDelete(col.id)} className="p-1 hover:bg-red-900 text-red-400 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
