"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Smartphone } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | "other";

interface Ctx {
  /** Brskalnik je sprožil dogodek za namestitev (Chrome/Edge na Androidu in namizju). */
  canPrompt: boolean;
  /** Aplikacija že teče kot nameščena (samostojno okno). */
  standalone: boolean;
  platform: Platform;
  isIosChrome: boolean;
  install: () => Promise<void>;
}

const PwaContext = createContext<Ctx>({
  canPrompt: false, standalone: false, platform: "other", isIosChrome: false, install: async () => {},
});

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [isIosChrome, setIosChrome] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIosChrome(/CriOS/.test(navigator.userAgent));
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(mq.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    update();
    mq.addEventListener("change", update);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // namestitev ponudimo sami, z gumbom
      deferred.current = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setCanPrompt(false);
      update();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Service worker samo v produkciji (v razvoju bi predpomnilnik motil)
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* brez SW namestitev še vedno deluje v nekaterih brskalnikih */ });
    }
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const ev = deferred.current;
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
    deferred.current = null; // dogodek je mogoče uporabiti samo enkrat
    setCanPrompt(false);
  }, []);

  const value = useMemo(() => ({ canPrompt, standalone, platform, isIosChrome, install }), [canPrompt, standalone, platform, isIosChrome, install]);
  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export const usePwa = () => useContext(PwaContext);

/** Gumb »Namesti aplikacijo«: neposredna namestitev, če jo brskalnik omogoča, sicer navodila za napravo. */
export default function InstallButton({ className = "" }: { className?: string }) {
  const { canPrompt, standalone, platform, isIosChrome, install } = usePwa();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [diag, setDiag] = useState<{ secure: boolean; sw: string; manifest: string } | null>(null);

  // Ko uporabnik odpre navodila, preverimo, zakaj namestitev morda ni na voljo.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const secure = window.isSecureContext;
      let sw = "ni podprt";
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        sw = reg?.active ? "aktiven" : reg ? "se namešča" : secure ? "ni registriran (osveži stran)" : "ni mogoč (stran ni https)";
      }
      let manifest = "ni dosegljiv";
      try {
        const r = await fetch("/manifest.json", { cache: "no-store" });
        if (r.ok) { const j = await r.json(); manifest = Array.isArray(j.icons) && j.icons.length ? "v redu" : "brez ikon"; }
        else manifest = `HTTP ${r.status}`;
      } catch { /* ostane "ni dosegljiv" */ }
      if (!cancelled) setDiag({ secure, sw, manifest });
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (standalone) return null;

  const onClick = () => {
    if (canPrompt) void install();
    else setOpen(o => !o);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={onClick}
        title="Namesti aplikacijo"
        aria-label="Namesti aplikacijo"
        aria-expanded={open}
        className="flex items-center gap-1 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-white text-[11px]"
      >
        <Smartphone size={14} />
      </button>
      {open && (
        <div role="dialog" aria-label="Namestitev aplikacije" className="absolute right-0 top-full z-[200] mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-600 bg-gray-800 p-3 text-xs shadow-2xl">
          <div className="mb-1 font-bold text-gray-100">Namesti kot aplikacijo</div>
          {platform === "ios" ? (
            <ol className="list-decimal space-y-1 pl-4 text-gray-300">
              <li>
                {isIosChrome
                  ? "V Chromu tapni ikono za deljenje (kvadrat s puščico) ob naslovni vrstici."
                  : "V Safariju tapni gumb »Deli« (kvadrat s puščico) na dnu zaslona."}
              </li>
              <li>Izberi »Dodaj na začetni zaslon«.</li>
              <li>Potrdi z »Dodaj«. Ikona se pojavi med aplikacijami.</li>
            </ol>
          ) : platform === "android" ? (
            <ol className="list-decimal space-y-1 pl-4 text-gray-300">
              <li>V Chromu tapni meni ⋮ (zgoraj desno).</li>
              <li>Izberi »Namesti aplikacijo« ali »Dodaj na začetni zaslon«.</li>
            </ol>
          ) : (
            <p className="text-gray-300">V naslovni vrstici brskalnika (Chrome/Edge) klikni ikono za namestitev ali meni ⋮ → »Namesti aplikacijo«.</p>
          )}
          {diag && (
            <div className="mt-2 space-y-0.5 border-t border-gray-700 pt-2 text-[11px]">
              <div className={diag.secure ? "text-green-400" : "text-red-400"}>
                {diag.secure ? "✓ Varna povezava (https)" : "✕ Stran ni na https – Chrome zato ne ponudi namestitve"}
              </div>
              <div className="text-gray-400">Service worker: {diag.sw}</div>
              <div className="text-gray-400">Manifest: {diag.manifest}</div>
              {!diag.secure && (
                <p className="pt-1 text-yellow-400">
                  Odpri aplikacijo prek https:// naslova (reverse proxy s certifikatom). Prek http:// in naslova IP Chrome ponudi samo bližnjico, ne prave namestitve.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
