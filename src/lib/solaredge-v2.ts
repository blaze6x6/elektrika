import { randomBytes } from "node:crypto";
import { loadSettingsDecrypted, saveSetting } from "@/lib/settings";
import { fetchT } from "@/lib/http";

/**
 * SolarEdge Monitoring API v2 – prijava z OAuth 2.0 (Authorization Code, »Site Access«).
 * Dokumentacija: https://api-docs.solaredge.com (Authentication).
 *
 * Žetoni so v bazi (app_settings, šifrirani): se2_access, se2_refresh; ostalo: se2_expires (ms), se2_site, se2_connected_at.
 * Osveževalni žeton je ENKRATEN: vsako osvežitev vrne nov par, stari postane neveljaven → par shranimo takoj
 * in osveževanje v procesu serializiramo (en sam hkratni klic).
 */

export const SE_V2_BASE = "https://monitoringapi.solaredge.com/v2";
export const SE_AUTHORIZE_URL = "https://connect.solaredge.com/authorize";

export function oauthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SOLAREDGE_CLIENT_ID?.trim();
  const clientSecret = process.env.SOLAREDGE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Redirect URL, ki ga je treba nastaviti v razvijalski konzoli (SOLAREDGE_REDIRECT_URI ali iz glav proxyja). */
export function redirectUri(headers: Headers): string {
  const env = process.env.SOLAREDGE_REDIRECT_URI?.trim();
  if (env) return env;
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000").split(",")[0].trim();
  const proto = (headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}/api/solaredge/oauth/callback`;
}

export const newState = () => randomBytes(16).toString("hex");

type TokenResponse = { access_token: string; refresh_token: string; expires_in?: number; token_type?: string };

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchT(`${SE_V2_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
    const detail = [json.error, json.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`;
    throw new Error(`SolarEdge OAuth: ${detail}`);
  }
  return json as unknown as TokenResponse;
}

async function storeTokens(t: TokenResponse, site?: string) {
  const expires = Date.now() + (Number(t.expires_in) > 0 ? Number(t.expires_in) : 7200) * 1000;
  // najprej osveževalni žeton – če bi se zapis prekinil, je to edini, ki ga ne smemo izgubiti
  await saveSetting("se2_refresh", t.refresh_token);
  await saveSetting("se2_access", t.access_token);
  await saveSetting("se2_expires", String(expires));
  if (site) await saveSetting("se2_site", site);
}

/** Zamenja kodo iz povratnega klica za žetona in ju shrani. */
export async function connectWithCode(code: string, siteId: string, redirect?: string): Promise<void> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("SOLAREDGE_CLIENT_ID / SOLAREDGE_CLIENT_SECRET nista nastavljena.");
  const t = await postToken({
    grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
    ...(redirect ? { redirect_uri: redirect } : {}),
  });
  await storeTokens(t, siteId);
  await saveSetting("se2_connected_at", new Date().toISOString());
}

export async function disconnect(): Promise<void> {
  const s = await loadSettingsDecrypted();
  const cfg = oauthConfig();
  for (const tok of [s.se2_refresh, s.se2_access]) {
    if (!tok || !cfg) continue;
    try {
      await fetchT(`${SE_V2_BASE}/oauth2/revoke-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      });
    } catch { /* odjava naj uspe tudi brez omrežja */ }
  }
  for (const k of ["se2_access", "se2_refresh", "se2_expires", "se2_site", "se2_connected_at"]) await saveSetting(k, "");
}

export type SeStatus = {
  configured: boolean;
  connected: boolean;
  site: string | null;
  connectedAt: string | null;
  accessExpiresAt: string | null;
};

export async function connectionStatus(): Promise<SeStatus> {
  const s = await loadSettingsDecrypted();
  const exp = Number(s.se2_expires);
  return {
    configured: !!oauthConfig(),
    connected: !!s.se2_refresh,
    site: s.se2_site || process.env.SOLAREDGE_SITE_ID || null,
    connectedAt: s.se2_connected_at || null,
    accessExpiresAt: exp > 0 ? new Date(exp).toISOString() : null,
  };
}

let refreshing: Promise<void> | null = null;

async function doRefresh(): Promise<void> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("SOLAREDGE_CLIENT_ID / SOLAREDGE_CLIENT_SECRET nista nastavljena.");
  const s = await loadSettingsDecrypted();
  if (!s.se2_refresh) throw new Error("SolarEdge ni povezan (Administracija → SolarEdge API v2 → Poveži).");
  const t = await postToken({ grant_type: "refresh_token", refresh_token: s.se2_refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  await storeTokens(t);
}

/** Veljaven dostopni žeton (po potrebi ga osveži). */
export async function getAccess(forceRefresh = false): Promise<{ token: string; site: string }> {
  let s = await loadSettingsDecrypted();
  const exp = Number(s.se2_expires) || 0;
  if (!s.se2_access || forceRefresh || exp - 120_000 < Date.now()) {
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
    await refreshing;
    s = await loadSettingsDecrypted();
  }
  const site = s.se2_site || process.env.SOLAREDGE_SITE_ID || "";
  if (!site) throw new Error("ID elektrarne ni znan.");
  return { token: s.se2_access, site };
}

export type V2Result = {
  status: number;
  /** x-ratelimit-* in retry-after – za kontrolo kreditov in klicev na minuto. */
  rate: Record<string, string>;
  body: unknown;
};

/** GET na v2 z Bearer žetonom; ob 401 enkrat osveži žeton in ponovi. `path` je relativen na /sites/{id}. */
export async function v2Get(path: string, params: Record<string, string> = {}): Promise<V2Result> {
  const call = async (token: string, site: string) => {
    const qs = new URLSearchParams(params).toString();
    const url = `${SE_V2_BASE}/sites/${encodeURIComponent(site)}${path}${qs ? `?${qs}` : ""}`;
    return fetchT(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" }, 30000);
  };
  let { token, site } = await getAccess();
  let res = await call(token, site);
  if (res.status === 401) {
    ({ token, site } = await getAccess(true));
    res = await call(token, site);
  }
  const rate: Record<string, string> = {};
  res.headers.forEach((v, k) => { if (/^(x-ratelimit|retry-after)/i.test(k)) rate[k] = v; });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* ostane besedilo */ }
  return { status: res.status, rate, body };
}
