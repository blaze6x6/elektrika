/**
 * Privzete tarife (PRIMER – prilagodi svojemu računu v Kalkulator → Tarife).
 * Vrednosti izhajajo iz računa dobavitelja za 2024+ in so lahko zastarele.
 */
export const DEFAULT_TARIFF: Record<string, number> = {
  // Električna energija
  cena_energija_et: 0.1299, // EUR/kWh – enotna tarifa
  cena_omreznina_et: 0.01864, // EUR/kWh (pavšalna, če ni blokov)

  // Omrežnina – cene za preneseno energijo po blokih (€/kWh)
  cena_omreznina_blok1: 0.01958,
  cena_omreznina_blok2: 0.01182,
  cena_omreznina_blok3: 0.00392,
  cena_omreznina_blok4: 0.00033,
  cena_omreznina_blok5: 0.00003,

  // Cene za bloke dogovorjene moči (€/kW)
  cena_moc_blok1: 3.82301,
  cena_moc_blok2: 1.0923,
  cena_moc_blok3: 0.28902,
  cena_moc_blok4: 0.02436,
  cena_moc_blok5: 0.00245,

  // Dogovorjena moč po blokih (kW)
  moc_blok1: 7.2,
  moc_blok2: 7.2,
  moc_blok3: 7.2,
  moc_blok4: 7.2,
  moc_blok5: 7.2,

  // Prispevki
  prisp_operater_trg: 0.00013, // EUR/kWh
  prisp_energ_ucinkovitost: 0.0008, // EUR/kWh
  prisp_spte_ove: 0.77562, // EUR/kW
  trosarina: 0.00153, // EUR/kWh
  mesecno_nadomestilo: 1.99, // EUR/kos
  eko_popust: -1.0, // EUR/kos
  ddv_stopnja: 0.22, // 22 %
};

export const TARIFF_KEYS = Object.keys(DEFAULT_TARIFF);

/** Preveri in očisti vhodno tarifo. Dovoljeni so samo znani ključi in končna števila. */
export function sanitizeTariff(
  input: unknown
): { ok: true; values: Record<string, number> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "tariff mora biti objekt" };
  }
  const values: Record<string, number> = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!TARIFF_KEYS.includes(k)) return { ok: false, error: `Neznan ključ tarife: ${k}` };
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
    if (!Number.isFinite(n)) return { ok: false, error: `Neveljavna vrednost za ${k}` };
    if (k === "ddv_stopnja") {
      if (n < 0 || n > 1) return { ok: false, error: "ddv_stopnja mora biti med 0 in 1" };
    } else if (k.startsWith("moc_blok")) {
      if (n < 0 || n > 1000) return { ok: false, error: `${k} mora biti med 0 in 1000 kW` };
    } else if (Math.abs(n) > 1000) {
      return { ok: false, error: `${k} je izven dovoljenega obsega` };
    }
    values[k] = n;
  }
  return { ok: true, values };
}
