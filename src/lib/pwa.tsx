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
          <p className="mt-2 text-[10px] text-gray-500">Namestitev zahteva varno povezavo (https). Če možnosti ni, osveži stran in poskusi znova.</p>
        </div>
      )}
    </div>
  );
}
