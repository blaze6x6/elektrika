// Seznam barvnih tem. Same barve so definirane v src/app/globals.css (html[data-theme="..."]).
// Za novo temo: dodajte blok v globals.css in vrstico tukaj.

export type ThemeId =
  | "dark" | "midnight" | "nord" | "dracula" | "forest" | "ember" | "amoled"
  | "light" | "paper" | "mint" | "sky" | "lavender";
export type ThemePref = ThemeId | "auto";

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  light: boolean;
  /** [ozadje strani, ozadje kartice, poudarek] – samo za predogled v izbirniku */
  swatch: [string, string, string];
}

export const THEMES: ThemeInfo[] = [
  { id: "dark", label: "Temna", light: false, swatch: ["#111827", "#1f2937", "#2563eb"] },
  { id: "midnight", label: "Polnočna", light: false, swatch: ["#131a2a", "#1c273f", "#1273e2"] },
  { id: "nord", label: "Nord", light: false, swatch: ["#1a1d23", "#272b35", "#439ab1"] },
  { id: "dracula", label: "Vijolična", light: false, swatch: ["#1c1a23", "#292735", "#7418dc"] },
  { id: "forest", label: "Gozd", light: false, swatch: ["#1a231f", "#27342e", "#31c467"] },
  { id: "ember", label: "Žerjavica", light: false, swatch: ["#231d1a", "#342c27", "#e9640c"] },
  { id: "amoled", label: "AMOLED", light: false, swatch: ["#000000", "#0f0f0f", "#0c61e9"] },
  { id: "light", label: "Svetla", light: true, swatch: ["#f0f2f4", "#fcfcfd", "#124bc4"] },
  { id: "paper", label: "Papir", light: true, swatch: ["#f6f3ef", "#fdfdfc", "#b85c1e"] },
  { id: "mint", label: "Meta", light: true, swatch: ["#f0f5f2", "#fcfdfc", "#11976f"] },
  { id: "sky", label: "Nebo", light: true, swatch: ["#edf3f8", "#fbfdfe", "#0a6f9e"] },
  { id: "lavender", label: "Sivka", light: true, swatch: ["#f1eef6", "#fcfcfd", "#5f25b1"] },
];

export const DEFAULT_DARK: ThemeId = "dark";
export const DEFAULT_LIGHT: ThemeId = "light";
export const STORAGE_KEY = "theme";

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && THEMES.some(t => t.id === v);
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === "auto" || isThemeId(v);
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeId {
  if (pref === "auto") return systemDark ? DEFAULT_DARK : DEFAULT_LIGHT;
  return pref;
}

/** Barve za Chart.js glede na svetlo/temno ozadje. */
export function chartColors(light: boolean) {
  return light
    ? { axis: "#374151", legend: "#111827", grid: "rgba(107,114,128,0.25)" }
    : { axis: "#9ca3af", legend: "#d1d5db", grid: "rgba(75,85,99,0.3)" };
}

/**
 * Skript, ki se izvede pred izrisom strani (brez utripanja ob nalaganju).
 * Mora ostati sinhrono usklajen z resolveTheme zgoraj.
 */
export function themeInitScript(): string {
  const light = THEMES.filter(t => t.light).map(t => t.id);
  const ids = THEMES.map(t => t.id);
  return `(function(){try{var ids=${JSON.stringify(ids)},light=${JSON.stringify(light)};var p=localStorage.getItem("${STORAGE_KEY}");if(p!=="auto"&&ids.indexOf(p)<0)p="auto";var t=p;if(p==="auto")t=window.matchMedia("(prefers-color-scheme: light)").matches?"${DEFAULT_LIGHT}":"${DEFAULT_DARK}";var d=document.documentElement;d.setAttribute("data-theme",t);d.setAttribute("data-mode",light.indexOf(t)>=0?"light":"dark");}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-mode","dark");}})();`;
}
