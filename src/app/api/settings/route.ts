import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, readJson } from "@/lib/http";
import { EMAIL_SETTING_KEYS, loadPublicEmailSettings, saveSetting } from "@/lib/settings";
import { isValidHostname } from "@/lib/net";

const BOOL_KEYS = new Set(["email_enabled", "alerts_enabled", "smtp_allow_selfsigned"]);
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function validateSetting(key: string, value: string): string | null {
  if (value.length > 500) return `${key}: vrednost je predolga`;
  if (/[\r\n\u0000]/.test(value)) return `${key}: neveljavni znaki`;
  if (BOOL_KEYS.has(key) && value !== "true" && value !== "false") return `${key}: pričakovano true/false`;
  switch (key) {
    case "smtp_port": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return "smtp_port: neveljavna vrata";
      return null;
    }
    case "smtp_security":
      return ["ssl", "starttls", "none"].includes(value) ? null : "smtp_security: ssl | starttls | none";
    case "smtp_host":
      return value === "" || isValidHostname(value) ? null : "smtp_host: neveljavno ime strežnika";
    case "email_to": {
      if (value === "") return null;
      const list = value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0 || list.length > 5 || !list.every((e) => EMAIL_RE.test(e))) {
        return "email_to: do 5 veljavnih e-poštnih naslovov";
      }
      return null;
    }
    case "alert_threshold": {
      const n = Number(value.replace(",", "."));
      return value === "" || (Number.isFinite(n) && n >= 0 && n < 100000) ? null : "alert_threshold: neveljavno število";
    }
    default:
      return null;
  }
}

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  // skrivnosti (smtp_pass) se NIKOLI ne vrnejo odjemalcu – samo smtp_pass_set
  return NextResponse.json({ settings: await loadPublicEmailSettings() });
}

/**
 * POST { settings: { ključ: vrednost, ... } }  ali  { key, value }
 * Dovoljeni so samo znani ključi. Prazen smtp_pass pomeni "ne spreminjaj";
 * za brisanje pošlji { clearSmtpPass: true }.
 */
export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = await readJson(request);
  if (!body) return badRequest("Neveljavno telo zahteve");

  let entries: Array<[string, unknown]>;
  if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
    entries = Object.entries(body.settings as Record<string, unknown>);
  } else if (typeof body.key === "string") {
    entries = [[body.key, body.value]];
  } else {
    return badRequest("settings ali key required");
  }

  const allowed = new Set<string>(EMAIL_SETTING_KEYS);
  const toSave: Array<[string, string]> = [];
  for (const [key, raw] of entries) {
    if (!allowed.has(key)) {
      if (key === "smtp_pass_set") continue; // pomožno polje iz GET
      return badRequest(`Neznan ključ nastavitve: ${key}`);
    }
    const value = raw === undefined || raw === null ? "" : String(raw);
    if (key === "smtp_pass") {
      if (value === "" && body.clearSmtpPass !== true) continue; // ohrani obstoječe
      if (value.length > 200) return badRequest("smtp_pass: predolgo");
      toSave.push([key, value]);
      continue;
    }
    const problem = validateSetting(key, value);
    if (problem) return badRequest(problem);
    toSave.push([key, value]);
  }
  if (body.clearSmtpPass === true && !toSave.some(([k]) => k === "smtp_pass")) toSave.push(["smtp_pass", ""]);

  for (const [k, v] of toSave) await saveSetting(k, v);
  await logAction(g.user.username, "settings", `posodobljeno: ${toSave.map(([k]) => k).join(", ") || "-"}`);
  return NextResponse.json({ success: true });
}
