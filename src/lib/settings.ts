import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/** Ključi, ki jih sme urejati stran "E-mail in opozorila". Vse ostalo se zavrne. */
export const EMAIL_SETTING_KEYS = [
  "email_enabled",
  "alerts_enabled",
  "email_to",
  "smtp_host",
  "smtp_port",
  "smtp_security",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  "smtp_from_name",
  "smtp_allow_selfsigned",
  "alert_threshold",
] as const;

export const SECRET_SETTING_KEYS = ["smtp_pass"];

export async function loadAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings);
  const s: Record<string, string> = {};
  rows.forEach((r) => {
    s[r.key] = r.value || "";
  });
  return s;
}

/** Nastavitve za uporabo na strežniku (skrivnosti odšifrirane). */
export async function loadSettingsDecrypted(): Promise<Record<string, string>> {
  const s = await loadAllSettings();
  for (const k of SECRET_SETTING_KEYS) if (s[k]) s[k] = decryptSecret(s[k]);
  return s;
}

/** Nastavitve za odjemalca: brez skrivnosti, samo znani e-mail ključi. */
export async function loadPublicEmailSettings(): Promise<Record<string, string>> {
  const s = await loadAllSettings();
  const out: Record<string, string> = {};
  for (const k of EMAIL_SETTING_KEYS) {
    if (SECRET_SETTING_KEYS.includes(k)) {
      out[`${k}_set`] = s[k] ? "true" : "false";
    } else {
      out[k] = s[k] ?? "";
    }
  }
  return out;
}

export async function saveSetting(key: string, value: string) {
  const stored = SECRET_SETTING_KEYS.includes(key) && value ? encryptSecret(value) : value;
  await db
    .insert(appSettings)
    .values({ key, value: stored })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } });
}
