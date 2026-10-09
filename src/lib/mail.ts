import { lookup } from "node:dns/promises";
import nodemailer from "nodemailer";
import { ALLOWED_SMTP_PORTS, isBlockedIp, isValidHostname } from "@/lib/net";
import { escapeHtml } from "@/lib/validate";

type Settings = Record<string, string>;

export type SmtpConfig = {
  host: string;
  port: number;
  security: string;
  user: string;
  pass: string;
  from: string;
  to: string;
  allowSelfSigned: boolean;
};

export function readSmtpConfig(s: Settings): SmtpConfig {
  const port = parseInt(s["smtp_port"] || process.env.SMTP_PORT || "587", 10);
  const fromEmail = (s["smtp_from"] || process.env.SMTP_FROM || s["smtp_user"] || process.env.SMTP_USER || "").replace(/[\r\n"<>]/g, "");
  const fromName = (s["smtp_from_name"] || "").replace(/[\r\n"<>]/g, "");
  return {
    host: s["smtp_host"] || process.env.SMTP_HOST || "",
    port: Number.isFinite(port) ? port : 587,
    security: s["smtp_security"] || "starttls",
    user: s["smtp_user"] || process.env.SMTP_USER || "",
    pass: s["smtp_pass"] || process.env.SMTP_PASS || "",
    from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to: s["email_to"] || "",
    allowSelfSigned: s["smtp_allow_selfsigned"] === "true",
  };
}

/**
 * Zaščita pred SSRF: skrbnik lahko nastavi poljuben SMTP strežnik, zato
 * preverimo ime, vrata in razrešene naslove. Lokalne SMTP strežnike v LAN
 * omogoča SMTP_ALLOW_INTERNAL=true.
 */
export async function assertSmtpTarget(host: string, port: number): Promise<void> {
  if (!isValidHostname(host)) throw new Error("Neveljavno ime SMTP strežnika.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Neveljavna SMTP vrata.");
  if (process.env.SMTP_ALLOW_INTERNAL === "true") return;
  if (!ALLOWED_SMTP_PORTS.includes(port)) {
    throw new Error(`SMTP vrata ${port} niso dovoljena (dovoljena: ${ALLOWED_SMTP_PORTS.join(", ")}).`);
  }
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new Error("SMTP strežnika ni mogoče razrešiti (DNS).");
  });
  if (addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error("SMTP strežnik kaže na prepovedan (lokalni/link-local) naslov.");
  }
}

export async function buildTransport(cfg: SmtpConfig) {
  await assertSmtpTarget(cfg.host, cfg.port);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.security === "ssl",
    requireTLS: cfg.security === "starttls",
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: { rejectUnauthorized: !cfg.allowSelfSigned },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

const fmt = (n: number, d = 2) => n.toFixed(d).replace(".", ",");

type ColLite = { key: string; label: string; unit: string | null };

export function reportHtml(month: string, cols: ColLite[], totals: Record<string, number>): string {
  const rows = cols
    .map((c) => {
      const v = totals[c.key] ?? 0;
      return `<tr><td style="padding:8px 12px;border:1px solid #374151">${escapeHtml(c.label)}</td><td style="padding:8px 12px;border:1px solid #374151;text-align:right;font-weight:bold;color:${v < 0 ? "#ef4444" : "#22c55e"}">${fmt(v)} ${escapeHtml(c.unit || "kWh")}</td></tr>`;
    })
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#111827;color:#e5e7eb;padding:24px;border-radius:12px">
      <h2 style="margin:0 0 4px;color:#22c55e">⚡ Mesečno poročilo</h2>
      <p style="margin:0 0 16px;color:#9ca3af;font-size:14px">${escapeHtml(month)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#1f2937"><th style="padding:8px 12px;border:1px solid #374151;text-align:left;color:#9ca3af">Stolpec</th><th style="padding:8px 12px;border:1px solid #374151;text-align:right;color:#9ca3af">Skupaj</th></tr>
        ${rows}
      </table>
      <p style="color:#6b7280;font-size:11px;margin-top:20px;text-align:center">Avtomatsko generirano · Štrom poraba</p>
    </div>`;
}

export function alertHtml(dateStr: string, value: number, threshold: number): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#1f2937;color:#e5e7eb;padding:20px;border-radius:12px">
      <h2 style="color:#ef4444">🔔 Opozorilo – visoka poraba</h2>
      <p>Dne <strong>${escapeHtml(dateStr)}</strong> je bila skupna poraba <strong style="color:#ef4444">${fmt(value, 1)} kWh</strong>, kar presega nastavljeni prag <strong>${fmt(threshold, 1)} kWh</strong>.</p>
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Avtomatsko generirano – Štrom poraba</p>
    </div>`;
}
