"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { STORAGE_KEY, ThemeId, ThemePref, isThemePref, resolveTheme, themeInfo } from "./themes";

interface Ctx {
  /** Izbira uporabnika (lahko "auto") */
  pref: ThemePref;
  /** Dejansko uporabljena tema */
  theme: ThemeId;
  isLight: boolean;
  setPref: (p: ThemePref) => void;
}

const ThemeContext = createContext<Ctx>({ pref: "auto", theme: "dark", isLight: false, setPref: () => {} });

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemePref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("auto");
  const [systemDark, setSystemDark] = useState(true);

  // Začetno stanje preberemo po hidraciji (strežnik ne pozna localStorage).
  useEffect(() => {
    setPrefState(readPref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    // sinhronizacija med zavihki
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) setPrefState(readPref()); };
    window.addEventListener("storage", onStorage);
    return () => { mq.removeEventListener("change", onChange); window.removeEventListener("storage", onStorage); };
  }, []);

  const theme = resolveTheme(pref, systemDark);
  const info = themeInfo(theme);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", theme);
    el.setAttribute("data-mode", info.light ? "light" : "dark");
    // barva vrstice brskalnika na telefonu
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = info.swatch[1];
  }, [theme, info]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* zasebni način – izbira velja do osvežitve */ }
  }, []);

  const value = useMemo(() => ({ pref, theme, isLight: info.light, setPref }), [pref, theme, info.light, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
