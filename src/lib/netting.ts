/**
 * Letni poračun (neto): koliko energije je bilo v letu prevzete več, kot je bilo oddane, in kaj to stane.
 * Čiste funkcije – uporablja jih stran Kalkulator → Letni poračun (in testi).
 */

export type NettingTariff = {
  cena_energija_et: number;
  cena_omreznina_et: number;
  cena_omreznina_blok1: number; cena_omreznina_blok2: number; cena_omreznina_blok3: number;
  cena_omreznina_blok4: number; cena_omreznina_blok5: number;
  prisp_operater_trg: number; prisp_energ_ucinkovitost: number; trosarina: number;
  ddv_stopnja: number;
};

export type NettingInput = {
  uvozKwh: number;      // A+ – prevzeto iz omrežja
  oddajaKwh: number;    // A− – oddano v omrežje
  blokiKwh?: number[];  // uvoz po blokih 1–5 (za uteženo omrežnino); če manjka, pavšalna omrežnina
  odkupCena?: number;   // €/kWh za presežek (privzeto 0)
};

export type NettingResult = {
  neto: number;               // uvoz − oddaja (kWh); > 0 = preveč porabljeno
  primanjkljajKwh: number;    // max(neto, 0)
  visekKwh: number;           // max(−neto, 0)
  cenaEnergija: number; cenaOmreznina: number; cenaOstalo: number; // €/kWh brez DDV
  energija: number; omreznina: number; ostalo: number;             // € brez DDV
  brezDdv: number; ddv: number; skupaj: number;                    // strošek primanjkljaja
  odkup: number;                                                    // izkupiček za presežek
};

export function omreznina(input: NettingInput, t: NettingTariff): number {
  const b = input.blokiKwh;
  const sum = b ? b.reduce((a, v) => a + v, 0) : 0;
  if (!b || sum <= 0) return t.cena_omreznina_et;
  const w = b.reduce((a, v, i) => a + v * (t as unknown as Record<string, number>)[`cena_omreznina_blok${i + 1}`], 0);
  return w / sum;
}

export function nettingCost(input: NettingInput, t: NettingTariff): NettingResult {
  const neto = input.uvozKwh - input.oddajaKwh;
  const primanjkljajKwh = Math.max(neto, 0);
  const visekKwh = Math.max(-neto, 0);
  const cenaEnergija = t.cena_energija_et;
  const cenaOmreznina = omreznina(input, t);
  const cenaOstalo = t.prisp_operater_trg + t.prisp_energ_ucinkovitost + t.trosarina;
  const energija = primanjkljajKwh * cenaEnergija;
  const om = primanjkljajKwh * cenaOmreznina;
  const ostalo = primanjkljajKwh * cenaOstalo;
  const brezDdv = energija + om + ostalo;
  const ddv = brezDdv * t.ddv_stopnja;
  return {
    neto, primanjkljajKwh, visekKwh, cenaEnergija, cenaOmreznina, cenaOstalo,
    energija, omreznina: om, ostalo, brezDdv, ddv, skupaj: brezDdv + ddv,
    odkup: visekKwh * (input.odkupCena ?? 0),
  };
}
