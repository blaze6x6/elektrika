/**
 * Pomožne funkcije za omejevanje odhodnih povezav (zaščita pred SSRF).
 * Čiste funkcije – brez DNS; razreševanje je v lib/mail.ts.
 */

function ipv4ToParts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p : null;
}

/** True za naslove, kamor SMTP odjemalec ne sme (loopback, link-local/metadata, nespecificirani). */
export function isBlockedIp(ipRaw: string): boolean {
  let ip = ipRaw.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7); // IPv4-mapped IPv6

  const v4 = ipv4ToParts(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return true; // loopback
    if (a === 0) return true; // nespecificirano
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    return false;
  }
  if (ip === "::1" || ip === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // fe80::/10
  return false;
}

export function isValidHostname(h: string): boolean {
  if (h.length === 0 || h.length > 253) return false;
  return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h) || /^[0-9a-fA-F:]+$/.test(h);
}

export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2465, 2525];
