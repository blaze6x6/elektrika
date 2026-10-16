"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Status = {
  configured: boolean;
  connected: boolean;
  site: string | null;
  connectedAt: string | null;
  accessExpiresAt: string | null;
  redirectUri: string;
};

/** ISO 8601 z lokalnim odmikom brskalnika, npr. 2026-10-14T00:00:00+02:00 */
function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
const dayStart = (offsetDays: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
};

const PRESETS: { label: string; path: string; resolution?: string; from?: () => string; to?: () => string }[] = [
  { label: "Meters: urna energija včeraj", path: "/meters/telemetry", resolution: "HOUR", from: () => iso(dayStart(-1)), to: () => iso(dayStart(0)) },
  { label: "Inverterji: urna energija včeraj", path: "/inverters/telemetry", resolution: "HOUR", from: () => iso(dayStart(-1)), to: () => iso(dayStart(0)) },
  { label: "Energija: urna proizvodnja včeraj", path: "/energy", resolution: "HOUR", from: () => iso(dayStart(-1)), to: () => iso(dayStart(0)) },
  { label: "Meters: dnevna energija (7 dni)", path: "/meters/telemetry", resolution: "DAY", from: () => iso(dayStart(-7)), to: () => iso(dayStart(0)) },
  { label: "Energija: dnevna proizvodnja (7 dni)", path: "/energy", resolution: "DAY", from: () => iso(dayStart(-7)), to: () => iso(dayStart(0)) },
  { label: "Naprave (merilniki, inverterji)", path: "/devices" },
  { label: "Elektrarna (osnovni podatki)", path: "" },
];

export default function SolarEdgeAdmin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [path, setPath] = useState("/meters/telemetry");
  const [resolution, setResolution] = useState("HOUR");
  const [from, setFrom] = useState(() => iso(dayStart(-1)));
  const [to, setTo] = useState(() => iso(dayStart(0)));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    const r = await fetch("/api/solaredge/oauth/status");
    if (r.ok) setStatus(await r.json());
  }, []);

  useEffect(() => {
    loadStatus();
    const q = new URLSearchParams(window.location.search);
    const st = q.get("status");
    if (st === "connected") setMsg({ ok: true, text: "SolarEdge je povezan." });
    if (st === "error") setMsg({ ok: false, text: q.get("msg") || "Povezava ni uspela." });
    if (st) window.history.replaceState(null, "", window.location.pathname);
  }, [loadStatus]);

  const disconnect = async () => {
    if (!confirm("Odklopim SolarEdge? Za ponovno povezavo bo treba znova odobriti dostop.")) return;
    await fetch("/api/solaredge/oauth/disconnect", { method: "POST" });
    setResult(null);
    setMsg({ ok: true, text: "Povezava odstranjena." });
    loadStatus();
  };

  const run = async () => {
    setLoading(true);
    setResult(null);
    const p = new URLSearchParams({ path });
    if (resolution && path !== "" && path !== "/devices") p.set("resolution", resolution);
    if (from && !["", "/devices"].includes(path)) p.set("from", from);
    if (to && !["", "/devices"].includes(path)) p.set("to", to);
    try {
      const r = await fetch(`/api/solaredge/v2/diag?${p}`);
      setResult(await r.json());
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Napaka" });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* brez odložišča */ }
  };

  const applyPreset = (i: number) => {
    const pr = PRESETS[i];
    setPath(pr.path);
    if (pr.resolution) setResolution(pr.resolution);
    if (pr.from) setFrom(pr.from());
    if (pr.to) setTo(pr.to());
  };

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString("sl-SI") : "–");

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">SolarEdge API v2</h1>
        <ThemeSwitcher className="ml-auto" />
      </header>

      <main className="p-4 max-w-4xl mx-auto space-y-4">
        {msg && (
          <div className={`rounded-xl p-3 text-sm border ${msg.ok ? "bg-green-900/30 border-green-700 text-green-300" : "bg-red-900/30 border-red-700 text-red-300"}`}>
            {msg.ok ? "✅" : "❌"} {msg.text}
          </div>
        )}

        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <h2 className="font-bold">Povezava</h2>
          {!status ? (
            <p className="text-sm text-gray-400">Nalagam…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-gray-700 p-2">
                  <div className="text-gray-400">Poverilnice v .env</div>
                  <div className={status.configured ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{status.configured ? "nastavljene" : "manjkajo"}</div>
                </div>
                <div className="rounded-lg border border-gray-700 p-2">
                  <div className="text-gray-400">Povezava</div>
                  <div className={status.connected ? "text-green-400 font-bold" : "text-yellow-400 font-bold"}>{status.connected ? "povezano" : "ni povezano"}</div>
                </div>
                <div className="rounded-lg border border-gray-700 p-2">
                  <div className="text-gray-400">ID elektrarne</div>
                  <div className="font-bold">{status.site ?? "–"}</div>
                </div>
                <div className="rounded-lg border border-gray-700 p-2">
                  <div className="text-gray-400">Povezano / žeton poteče</div>
                  <div className="font-bold">{fmtDate(status.connectedAt)} / {fmtDate(status.accessExpiresAt)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-400">
                Redirect URL v razvijalski konzoli mora biti natanko:
                <code className="block mt-1 p-2 rounded bg-gray-950 border border-gray-700 text-gray-200 break-all">{status.redirectUri}</code>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* navadna povezava: gre za preusmeritev na SolarEdge Connect */}
                <a
                  href="/api/solaredge/oauth/start"
                  className={`px-4 py-2 rounded text-sm font-semibold ${status.configured ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-700 text-gray-500 pointer-events-none"}`}
                >
                  {status.connected ? "Ponovno poveži" : "Poveži SolarEdge"}
                </a>
                {status.connected && (
                  <button onClick={disconnect} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">Odklopi</button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <h2 className="font-bold">Diagnostika (neobdelani odgovori)</h2>
          <p className="text-xs text-gray-400">Vsak klic porabi 1 kredit (Free: 2000 / mesec, 10 klicev na minuto). Odgovor lahko kopirate in pošljete za nadaljnjo nastavitev sinhronizacije.</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((pr, i) => (
              <button key={pr.label} onClick={() => applyPreset(i)} className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600">{pr.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="col-span-2">Pot
              <select value={path} onChange={(e) => setPath(e.target.value)} className="mt-1 w-full bg-gray-700 rounded px-2 py-1">
                <option value="">/sites/&#123;id&#125;</option>
                <option value="/overview">/overview</option>
                <option value="/energy">/energy</option>
                <option value="/power">/power</option>
                <option value="/lifetime-energy">/lifetime-energy</option>
                <option value="/meters/telemetry">/meters/telemetry</option>
                <option value="/inverters/telemetry">/inverters/telemetry</option>
                <option value="/devices">/devices</option>
              </select>
            </label>
            <label>Resolution
              <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="mt-1 w-full bg-gray-700 rounded px-2 py-1">
                {["QUARTER_HOUR", "HOUR", "DAY", "WEEK", "MONTH", "YEAR", "TOTAL"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <span />
            <label>from
              <input value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full bg-gray-700 rounded px-2 py-1" />
            </label>
            <label>to
              <input value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full bg-gray-700 rounded px-2 py-1" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={run} disabled={loading || !status?.connected} className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-50">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Nalagam…" : "Pošlji klic"}
            </button>
            {result !== null && (
              <button onClick={copy} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm">{copied ? "Kopirano" : "Kopiraj odgovor"}</button>
            )}
          </div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-auto max-h-[60vh] bg-gray-950 rounded-lg p-4 border border-gray-700">
            {result ? JSON.stringify(result, null, 2) : "Še ni odgovora."}
          </pre>
        </div>
      </main>
    </div>
  );
}
