"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Send } from "lucide-react";

export default function EmailAdmin() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(j => {
      setSettings(j.settings || {});
      setLoading(false);
    });
  }, []);

  const update = (key: string, value: string) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const ALL_KEYS = [
    "email_enabled", "alerts_enabled", "email_to",
    "smtp_host", "smtp_port", "smtp_security",
    "smtp_user", "smtp_pass",
    "smtp_from", "smtp_from_name",
    "alert_threshold",
  ];

  const handleSave = async () => {
    setSaving(true);
    for (const key of ALL_KEYS) {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: settings[key] || "" }),
      });
    }
    setSaving(false);
    setTestResult("✅ Nastavitve shranjene!");
    setTimeout(() => setTestResult(null), 3000);
  };

  const handleTestReport = async () => {
    setTestResult("⏳ Pošiljam testno poročilo...");
    const month = new Date().toISOString().slice(0, 7);
    const res = await fetch("/api/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    const json = await res.json();
    setTestResult(
      json.success
        ? "✅ Poročilo poslano!"
        : `❌ ${json.error || json.reason || "Napaka"}`
    );
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-500">
      Nalaganje...
    </div>
  );

  const security = settings.smtp_security || "starttls";

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">E-mail nastavitve</h1>
      </header>

      <main className="p-4 max-w-2xl mx-auto space-y-6">

        {/* Funkcije */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <h3 className="font-bold text-sm text-gray-300">Funkcije</h3>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <div className="font-medium text-sm">📧 Mesečno poročilo</div>
              <div className="text-xs text-gray-400">Pošlje povzetek 1. v mesecu za pretekli mesec</div>
            </div>
            <input type="checkbox"
              checked={settings.email_enabled === "true"}
              onChange={e => update("email_enabled", e.target.checked ? "true" : "false")}
              className="w-5 h-5 accent-green-500" />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <div className="font-medium text-sm">🔔 Opozorila ob visoki porabi</div>
              <div className="text-xs text-gray-400">Pošlje email, ko dnevna skupna poraba preseže prag</div>
            </div>
            <input type="checkbox"
              checked={settings.alerts_enabled === "true"}
              onChange={e => update("alerts_enabled", e.target.checked ? "true" : "false")}
              className="w-5 h-5 accent-green-500" />
          </label>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Prag za opozorilo (kWh/dan)</label>
            <input
              type="number" step="1" min="0"
              value={settings.alert_threshold || "50"}
              onChange={e => update("alert_threshold", e.target.value)}
              className="w-32 bg-gray-700 px-3 py-2 rounded text-sm" />
          </div>
        </div>

        {/* SMTP */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-300">SMTP strežnik</h3>
          <div className="grid grid-cols-2 gap-3">

            <div>
              <label className="block text-xs text-gray-400 mb-1">Strežnik (host)</label>
              <input
                value={settings.smtp_host || ""}
                onChange={e => update("smtp_host", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                placeholder="mail.example.com" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Port</label>
              <input
                value={settings.smtp_port || "587"}
                onChange={e => update("smtp_port", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                placeholder="587" />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-2">Šifriranje</label>
              <div className="flex gap-2">
                {[
                  { val: "none",     label: "Brez (plain)",   port: "25",  desc: "Ni priporočljivo" },
                  { val: "starttls", label: "STARTTLS",        port: "587", desc: "Priporočljivo" },
                  { val: "ssl",      label: "SSL/TLS",         port: "465", desc: "Varno" },
                ].map(opt => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => {
                      update("smtp_security", opt.val);
                      if (!settings.smtp_port || ["25","587","465"].includes(settings.smtp_port)) {
                        update("smtp_port", opt.port);
                      }
                    }}
                    className={`flex-1 py-2 px-2 rounded text-xs border-2 transition-colors text-center ${
                      security === opt.val
                        ? "border-blue-500 bg-blue-900/30 text-blue-300"
                        : "border-gray-600 text-gray-400 hover:border-gray-500"
                    }`}
                  >
                    <div className="font-bold">{opt.label}</div>
                    <div className="text-gray-500 text-[10px]">Port {opt.port} · {opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Uporabniško ime</label>
              <input
                value={settings.smtp_user || ""}
                onChange={e => update("smtp_user", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                autoComplete="off" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Geslo</label>
              <input
                type="password"
                value={settings.smtp_pass || ""}
                onChange={e => update("smtp_pass", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                autoComplete="new-password" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">E-mail pošiljatelja (From)</label>
              <input
                value={settings.smtp_from || ""}
                onChange={e => update("smtp_from", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                placeholder="energy@example.com" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Ime pošiljatelja</label>
              <input
                value={settings.smtp_from_name || ""}
                onChange={e => update("smtp_from_name", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                placeholder="Energy Report" />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Prejemniki obvestil (več naslovov loči z vejico)</label>
              <input
                value={settings.email_to || ""}
                onChange={e => update("email_to", e.target.value)}
                className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                placeholder="prvi@naslov.si, drugi@naslov.si" />
            </div>

          </div>
        </div>

        {/* Gumbi */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-semibold text-sm disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "Shranjujem..." : "Shrani nastavitve"}
          </button>
          <button
            onClick={handleTestReport}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-semibold text-sm"
          >
            <Send size={16} /> Pošlji testno poročilo
          </button>
        </div>

        {testResult && (
          <div className={`p-3 rounded text-sm ${
            testResult.startsWith("✅") ? "bg-green-900/30 text-green-400 border border-green-800" :
            testResult.startsWith("❌") ? "bg-red-900/30 text-red-400 border border-red-800" :
            "bg-blue-900/30 text-blue-300 border border-blue-800"
          }`}>
            {testResult}
          </div>
        )}

        {/* Info */}
        <div className="bg-gray-800/50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
          <p className="font-semibold text-gray-400">ℹ️ Namig za prikaz napak:</p>
          <p>Testno poročilo ne preveri, ali so poročila vklopljena – pošlje ga vedno, da lažje preverite nastavitve.</p>
          <p>Mesečno poročilo se avtomatsko pošlje <strong className="text-gray-300">1. v mesecu</strong> za pretekli mesec.</p>
          <p>Opozorila se preverjajo <strong className="text-gray-300">vsak dan ob 4:00</strong>.</p>
        </div>

      </main>
    </div>
  );
}
