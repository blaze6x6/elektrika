import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Obravnava skrivnosti (JWT_SECRET, CRON_SECRET).
 * V produkciji aplikacija odkloni zagon s praznimi, prekratkimi ali znanimi
 * privzetimi vrednostmi – te so javno znane (v repozitoriju/README).
 */

const KNOWN_BAD = [
  "default_secret_key_please_change_this_in_production",
  "spremeni_me_v_produkciji_abc123",
  "energy_cron_secret_123",
  "energy_pass_123",
];

export function secretProblem(value: string | undefined, minLen: number): string | null {
  if (!value) return "ni nastavljena";
  if (value.length < minLen) return `je prekratka (min. ${minLen} znakov)`;
  const lower = value.toLowerCase();
  if (KNOWN_BAD.includes(lower)) return "je znana privzeta vrednost";
  if (lower.includes("change_me") || lower.includes("changeme") || lower.includes("spremeni_me")) {
    return "je še vedno vzorčna vrednost";
  }
  return null;
}

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";
let jwtCache: string | null = null;
let warned = false;

export function getJwtSecret(): string {
  if (jwtCache) return jwtCache;
  const v = process.env.JWT_SECRET;
  const problem = secretProblem(v, 32);
  if (problem) {
    if (process.env.NODE_ENV === "production" && !isBuildPhase()) {
      throw new Error(
        `JWT_SECRET ${problem}. Ustvari ga z: openssl rand -hex 32 (in ga nastavi v .env).`
      );
    }
    if (!warned) {
      warned = true;
      console.warn(`[varnost] JWT_SECRET ${problem} – uporabljam samo razvojni ključ.`);
    }
    return "dev-only-insecure-secret-do-not-use-in-production-0000";
  }
  jwtCache = v as string;
  return jwtCache;
}

let cronWarned = false;
/** Vrne CRON_SECRET ali null, če je neveljaven (cron je takrat onemogočen). */
export function getCronSecret(): string | null {
  const v = process.env.CRON_SECRET;
  const problem = secretProblem(v, 16);
  if (problem) {
    if (!cronWarned && !isBuildPhase()) {
      cronWarned = true;
      console.warn(`[varnost] CRON_SECRET ${problem} – klici s skrivnostjo (cron) so onemogočeni.`);
    }
    return null;
  }
  return v as string;
}

/** Primerjava v konstantnem času (neodvisno od dolžine). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function cronAuthorized(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret");
  if (!header) return false;
  return safeEqual(header, secret);
}
