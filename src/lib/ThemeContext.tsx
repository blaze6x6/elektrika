"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { BARS_KEY, BarsPref, STORAGE_KEY, ThemeId, ThemePref, barColor, isBarsPref, isThemePref, resolveTheme, themeInfo } from "./themes";

interface Ctx {
  /** Izbira uporabnika (lahko "auto") */
  pref: ThemePref;
  /** Dejansko uporabljena tema */
  theme: ThemeId;
  isLight: boolean;
  setPref: (p: ThemePref) => void;
  /** Sistemske vrstice telefona: sledi temi / vedno svetle / vedno temne */
  bars: BarsPref;
  setBars: (b: BarsPref) => void;
}

const ThemeContext = createContext<Ctx>({ pref: "auto", theme: "dark", isLight: false, setPref: () => {}, bars: "theme", setBars: () => {} });

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemePref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function readBars(): BarsPref {
  try {
    const v = localStorage.getItem(BARS_KEY);
    return isBarsPref(v) ? v : "theme";
  } catch {
    return "theme";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("auto");
  const [bars, setBarsState] = useState<BarsPref>("theme");
  const [systemDark, setSystemDark] = useState(true);

  // Začetno stanje preberemo po hidraciji (strežnik ne pozna localStorage).
  useEffect(() => {
    setPrefState(readPref());
    setBarsState(readBars());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    // sinhronizacija med zavihki
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) setPrefState(readPref()); if (e.key === BARS_KEY) setBarsState(readBars()); };
    window.addEventListener("storage", onStorage);
    return () => { mq.removeEventListener("change", onChange); window.removeEventListener("storage", onStorage); };
  }, []);

  const theme = resolveTheme(pref, systemDark);
  const info = themeInfo(theme);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", theme);
    el.setAttribute("data-mode", info.light ? "light" : "dark");
  }, [theme, info]);

  useEffect(() => {
    // barva sistemskih vrstic telefona (neodvisno od teme, če tako izbere uporabnik)
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = barColor(bars, theme);
  }, [theme, bars]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* zasebni način – izbira velja do osvežitve */ }
  }, []);

  const setBars = useCallback((b: BarsPref) => {
    setBarsState(b);
    try { localStorage.setItem(BARS_KEY, b); } catch { /* zasebni način */ }
  }, []);

  const value = useMemo(() => ({ pref, theme, isLight: info.light, setPref, bars, setBars }), [pref, theme, info.light, setPref, bars, setBars]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
