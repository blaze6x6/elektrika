import test from "node:test";
import assert from "node:assert/strict";
import { nettingCost, type NettingTariff } from "../src/lib/netting.ts";

const t: NettingTariff = {
  cena_energija_et: 0.1, cena_omreznina_et: 0.02,
  cena_omreznina_blok1: 0.04, cena_omreznina_blok2: 0.02, cena_omreznina_blok3: 0, cena_omreznina_blok4: 0, cena_omreznina_blok5: 0,
  prisp_operater_trg: 0.001, prisp_energ_ucinkovitost: 0.001, trosarina: 0.003, ddv_stopnja: 0.22,
};

test("primanjkljaj: neto × (energija + omrežnina + prispevki) + DDV", () => {
  const r = nettingCost({ uvozKwh: 5000, oddajaKwh: 4000 }, t);
  assert.equal(r.neto, 1000);
  assert.equal(r.visekKwh, 0);
  assert.ok(Math.abs(r.brezDdv - 1000 * (0.1 + 0.02 + 0.005)) < 1e-9);
  assert.ok(Math.abs(r.skupaj - r.brezDdv * 1.22) < 1e-9);
});

test("presežek: strošek 0, izkupiček po ceni", () => {
  const r = nettingCost({ uvozKwh: 3000, oddajaKwh: 4000, odkupCena: 0.05 }, t);
  assert.equal(r.skupaj, 0);
  assert.equal(r.visekKwh, 1000);
  assert.equal(r.odkup, 50);
});

test("omrežnina se uteži z uvozom po blokih", () => {
  const r = nettingCost({ uvozKwh: 1000, oddajaKwh: 0, blokiKwh: [500, 500, 0, 0, 0] }, t);
  assert.ok(Math.abs(r.cenaOmreznina - 0.03) < 1e-12);
});
