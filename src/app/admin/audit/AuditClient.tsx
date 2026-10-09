"use client";
import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type LogEntry = { id: number; username: string; action: string; details: string | null; createdAt: string };

export default function AuditClient() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit")
      .then(r => r.json())
      .then(j => setLogs(j.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">Dnevnik sprememb</h1>
        <ThemeSwitcher className="ml-auto" />
      </header>
      <main className="p-4 max-w-3xl mx-auto">
        {loading ? <p className="text-gray-500">Nalaganje...</p> : (
          <div className="space-y-1">
            {logs.map(log => (
              <div key={log.id} className="bg-gray-800 rounded p-3 flex items-start gap-3 text-xs">
                <div className="shrink-0 text-gray-500 w-32">{new Date(log.createdAt).toLocaleString("sl-SI")}</div>
                <div className={`shrink-0 px-2 py-0.5 rounded font-bold text-[10px] ${
                  log.action === "edit" ? "bg-blue-900 text-blue-300" :
                  log.action === "import" ? "bg-yellow-900 text-yellow-300" :
                  log.action.startsWith("sync") ? "bg-green-900 text-green-300" :
                  log.action === "login_failed" ? "bg-red-900 text-red-300" :
                  log.action.startsWith("user_") || log.action === "password_change" ? "bg-purple-900 text-purple-300" :
                  "bg-gray-700 text-gray-300"
                }`}>{log.action}</div>
                <div className="text-gray-300 font-medium">{log.username}</div>
                <div className="text-gray-500 truncate flex-1">{log.details || ""}</div>
              </div>
            ))}
            {logs.length === 0 && <p className="text-gray-500 text-center py-8">Ni zabeleženih sprememb</p>}
          </div>
        )}
      </main>
    </div>
  );
}
