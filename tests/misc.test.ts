import { test } from "node:test";
import assert from "node:assert/strict";
import { Cooldown, RateLimiter } from "../src/lib/rate-limit.ts";
import { DEFAULT_TARIFF, TARIFF_KEYS, sanitizeTariff } from "../src/lib/tariff.ts";
import { isBlockedIp, isValidHostname } from "../src/lib/net.ts";
import { safeEqual, secretProblem } from "../src/lib/secrets.ts";

test("RateLimiter: zaklep po N neuspehih, odklep po poteku, success ponastavi", () => {
  const rl = new RateLimiter(3, 60_000, 300_000);
  const t0 = 1_000_000;
  assert.ok(rl.check("u", t0).allowed);
  rl.fail("u", t0); rl.fail("u", t0 + 1000);
  assert.ok(rl.check("u", t0 + 2000).allowed);
  rl.fail("u", t0 + 3000);
  const locked = rl.check("u", t0 + 4000);
  assert.ok(!locked.allowed);
  assert.ok(locked.retryAfterSec > 290);
  assert.ok(rl.check("u", t0 + 3000 + 300_001).allowed); // po poteku zaklepa
  // drug ključ ni prizadet
  assert.ok(rl.check("other", t0 + 4000).allowed);
  // success ponastavi števec
  const rl2 = new RateLimiter(2, 60_000, 60_000);
  rl2.fail("x", t0); rl2.success("x"); rl2.fail("x", t0 + 1);
  assert.ok(rl2.check("x", t0 + 2).allowed);
});

test("RateLimiter: stari neuspehi izven okna se ne štejejo", () => {
  const rl = new RateLimiter(2, 10_000, 60_000);
  rl.fail("k", 0);
  rl.fail("k", 20_000); // prvi je že izven okna
  assert.ok(rl.check("k", 20_001).allowed);
});

test("Cooldown", () => {
  const c = new Cooldown(30_000);
  assert.equal(c.hit("a", 0), 0);
  assert.equal(c.hit("a", 10_000), 20);
  assert.equal(c.hit("b", 10_000), 0);
  assert.equal(c.hit("a", 30_000), 0);
});

test("sanitizeTariff: samo znani ključi, končna števila, smiselni obsegi", () => {
  const ok = sanitizeTariff({ ddv_stopnja: 0.22, moc_blok1: "7,2", cena_energija_et: 0.13 });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.values.moc_blok1, 7.2);
  assert.ok(!sanitizeTariff({ neznan_kljuc: 1 }).ok);
  assert.ok(!sanitizeTariff({ ddv_stopnja: 22 }).ok); // 22 namesto 0.22
  assert.ok(!sanitizeTariff({ moc_blok1: -1 }).ok);
  assert.ok(!sanitizeTariff({ moc_blok1: 5000 }).ok);
  assert.ok(!sanitizeTariff({ cena_energija_et: NaN }).ok);
  assert.ok(!sanitizeTariff({ cena_energija_et: "abc" }).ok);
  assert.ok(!sanitizeTariff([]).ok);
  assert.ok(!sanitizeTariff(null).ok);
  assert.ok(!sanitizeTariff({ __proto__: { x: 1 }, constructor: 1 }).ok);
});

test("vsi ključi, ki jih pošilja kalkulator, so dovoljeni", () => {
  const sent = [
    "cena_energija_et", "cena_omreznina_et",
    "cena_moc_blok1", "cena_moc_blok2", "cena_moc_blok3", "cena_moc_blok4", "cena_moc_blok5",
    "moc_blok1", "moc_blok2", "moc_blok3", "moc_blok4", "moc_blok5",
    "cena_omreznina_blok1", "cena_omreznina_blok2", "cena_omreznina_blok3", "cena_omreznina_blok4", "cena_omreznina_blok5",
    "prisp_operater_trg", "prisp_energ_ucinkovitost", "prisp_spte_ove",
    "trosarina", "mesecno_nadomestilo", "eko_popust", "ddv_stopnja",
  ];
  for (const k of sent) assert.ok(TARIFF_KEYS.includes(k), k);
  assert.equal(sent.length, TARIFF_KEYS.length);
  const all = sanitizeTariff(DEFAULT_TARIFF);
  assert.ok(all.ok);
});

test("isBlockedIp (SSRF)", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "::1", "::", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
    assert.ok(isBlockedIp(ip), ip);
  }
  for (const ip of ["8.8.8.8", "192.168.1.10", "10.0.0.5", "172.18.0.2", "2001:db8::1"]) {
    assert.ok(!isBlockedIp(ip), ip);
  }
});

test("isValidHostname", () => {
  assert.ok(isValidHostname("smtp.gmail.com"));
  assert.ok(isValidHostname("mail-1.example.si"));
  assert.ok(!isValidHostname("evil.com/path"));
  assert.ok(!isValidHostname("a b"));
  assert.ok(!isValidHostname(""));
  assert.ok(!isValidHostname("-bad.com"));
});

test("secretProblem zavrne javno znane in vzorčne vrednosti", () => {
  assert.ok(secretProblem(undefined, 32));
  assert.ok(secretProblem("kratko", 32));
  assert.ok(secretProblem("spremeni_me_v_produkciji_abc123", 8));
  assert.ok(secretProblem("energy_cron_secret_123", 8));
  assert.ok(secretProblem("default_secret_key_please_change_this_in_production", 8));
  assert.ok(secretProblem("CHANGE_ME", 4));
  assert.ok(secretProblem("xxxxxxxx-CHANGE_ME-xxxxxxxxxxxxxxxxxxxxxxxx", 8));
  assert.equal(secretProblem("9f2c1b7a4d8e3f60a1b2c3d4e5f60718", 32), null);
});

test("safeEqual", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", "x"));
});
