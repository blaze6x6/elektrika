"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Palette } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { THEMES, ThemeInfo } from "./themes";

function Group({ title, items }: { title: string; items: ThemeInfo[] }) {
  const { pref, setPref } = useTheme();
  return (
    <div>
      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-500">{title}</div>
      <div className="grid grid-cols-2 gap-1 p-1">
        {items.map(t => (
          <button
            key={t.id}
            type="button"
            role="menuitemradio"
            aria-checked={pref === t.id}
            onClick={() => setPref(t.id)}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-gray-700 ${pref === t.id ? "ring-1 ring-blue-500" : ""}`}
          >
            <span className="flex shrink-0 overflow-hidden rounded border border-gray-600" aria-hidden>
              {t.swatch.map((c, i) => <span key={i} className="block h-4 w-3" style={{ background: c }} />)}
            </span>
            <span className="flex-1 truncate text-gray-200">{t.label}</span>
            {pref === t.id && <Check size={12} className="text-blue-400" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ThemeSwitcher({ className = "" }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Barvna tema"
        aria-label="Barvna tema"
        className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white"
      >
        <Palette size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[200] mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-600 bg-gray-800 p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={pref === "auto"}
            onClick={() => setPref("auto")}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-gray-700 ${pref === "auto" ? "ring-1 ring-blue-500" : ""}`}
          >
            <Monitor size={14} className="text-gray-400" />
            <span className="flex-1 text-gray-200">Samodejno (po sistemu)</span>
            {pref === "auto" && <Check size={12} className="text-blue-400" />}
          </button>
          <Group title="Temne" items={THEMES.filter(t => !t.light)} />
          <Group title="Svetle" items={THEMES.filter(t => t.light)} />
        </div>
      )}
    </div>
  );
}
