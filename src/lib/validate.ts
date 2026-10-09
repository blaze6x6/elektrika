/**
 * Čiste (brez odvisnosti) funkcije za validacijo in oblikovanje vhodov.
 * Uporabljajo jih API poti in testi.
 */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const COLUMN_KEY_RE = /^[a-z0-9_]{1,100}$/;
export const SOURCE_TYPES = ["manual", "solaredge", "melcloud", "mojelektro", "formula"] as const;

export function isValidMonth(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 2000 && y <= 2100;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidYear(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}$/.test(s)) return false;
  const y = Number(s);
  return y >= 2000 && y <= 2100;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Število dni med dvema datumoma (vključno z obema). */
export function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

export function addDaysStr(date: string, n: number): string {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Datum po LOKALNEM času strežnika (TZ), ne UTC. */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localMonthStr(d: Date = new Date()): string {
  return localDateStr(d).slice(0, 7);
}
export function yesterdayLocalStr(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return localDateStr(d);
}

export function parseId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n < 2147483647 ? n : null;
}

/** Razbere število v slovenski ali angleški obliki ("1.234,56", "1,5", "-3.2"). */
export function parseLocaleNumber(input: string): number | null {
  const s = input.replace(/[\s ]/g, "");
  if (!s) return null;
  let norm: string;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // zadnji ločilnik je decimalni
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) norm = s.replace(/\./g, "").replace(",", ".");
    else norm = s.replace(/,/g, "");
  } else if (hasComma) {
    if ((s.match(/,/g) || []).length > 1) return null;
    norm = s.replace(",", ".");
  } else {
    if ((s.match(/\./g) || []).length > 1) return null;
    norm = s;
  }
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Sprejme število ali številski niz; zavrne NaN/Infinity/prevelike vrednosti. */
export function toFiniteNumber(v: unknown, max = 1e9): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") n = parseLocaleNumber(v);
  if (n === null || !Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

export function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  // brez kontrolnih znakov
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

export function isValidUsername(u: unknown): u is string {
  return typeof u === "string" && /^[A-Za-z0-9._@-]{3,64}$/.test(u);
}

/** Politika gesel. Vrne sporočilo napake ali null. */
export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Geslo je obvezno";
  if (pw.length < 10) return "Geslo mora imeti vsaj 10 znakov";
  if (Buffer.byteLength(pw, "utf8") > 72) return "Geslo je predolgo (največ 72 bajtov)";
  if (/^(.)\1+$/.test(pw)) return "Geslo je preveč preprosto";
  const weak = ["password12", "1234567890", "qwertyuiop", "adminadmin", "administrator"];
  if (weak.includes(pw.toLowerCase())) return "Geslo je preveč pogosto";
  return null;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** CSV celica: zaščita pred formula-injection in pravilno citiranje (ločilo ;). */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Varno ime datoteke za Content-Disposition. */
export function safeFilenamePart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
