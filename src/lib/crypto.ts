import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getJwtSecret } from "./secrets";

/**
 * Šifriranje občutljivih nastavitev v bazi (npr. SMTP geslo) z AES-256-GCM.
 * Ključ izhaja iz SETTINGS_KEY (priporočeno) ali, če ga ni, iz JWT_SECRET.
 * Opozorilo: sprememba ključa naredi shranjene skrivnosti neberljive.
 */
const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.SETTINGS_KEY && process.env.SETTINGS_KEY.length >= 16
    ? process.env.SETTINGS_KEY
    : getJwtSecret();
  return Buffer.from(hkdfSync("sha256", secret, "elektrika-salt", "elektrika-settings-v1", 32));
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/** Odšifrira vrednost. Vrednosti brez predpone (starejše namestitve) vrne nespremenjene. */
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const [ivB, tagB, ctB] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
