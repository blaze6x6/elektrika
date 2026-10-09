import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFormulaMap, evaluateFormula, extractFormulaKeys, validateFormula } from "../src/lib/formula.ts";

test("osnovna aritmetika in prednost operatorjev", () => {
  assert.equal(evaluateFormula("1 + 2 * 3", {}), 7);
  assert.equal(evaluateFormula("(1 + 2) * 3", {}), 9);
  assert.equal(evaluateFormula("10 / 4", {}), 2.5);
  assert.equal(evaluateFormula("10 - 3 - 2", {}), 5); // levo asociativno
  assert.equal(evaluateFormula("-(2 + 3)", {}), -5);
});

test("sklici na stolpce", () => {
  const v = { a: 10, b: 4 };
  assert.equal(evaluateFormula("{a} + {b}", v), 14);
  assert.equal(evaluateFormula("{ a } - {b}", v), 6);
  assert.equal(evaluateFormula("{manjka} + 5", v), 5); // manjkajoč = 0
});

test("negativne vrednosti in -- ne pokvarijo formule (stara različica je vrnila 0)", () => {
  assert.equal(evaluateFormula("{a}-{b}", { a: 10, b: -5 }), 15);
  assert.equal(evaluateFormula("{a} - -{b}", { a: 10, b: 5 }), 15);
});

test("zelo majhne vrednosti (eksponentni zapis) ne razveljavijo formule", () => {
  assert.ok(Math.abs(evaluateFormula("{a} + {b}", { a: 1e-7, b: 2 }) - 2.0000001) < 1e-12);
});

test("deljenje z 0, NaN in Infinity vrnejo 0", () => {
  assert.equal(evaluateFormula("5 / 0", {}), 0);
  assert.equal(evaluateFormula("{a} + 1", { a: NaN }), 1);
  assert.equal(evaluateFormula("{a} + 1", { a: Infinity }), 1);
});

test("nevarni ali neveljavni vnosi vrnejo 0 in se nikoli ne izvedejo", () => {
  (globalThis as Record<string, unknown>).__pwned = false;
  for (const bad of [
    "globalThis.__pwned = true",
    "{a}; process.exit(1)",
    "1 + alert(1)",
    "constructor.constructor('return 1')()",
    "2 ** 3",
    "1e5",
    "",
    "   ",
    "(1 + 2",
    "1 + + ",
    "{a",
  ]) {
    assert.equal(evaluateFormula(bad, { a: 1 }), bad === "2 ** 3" ? 0 : 0, `formula: ${bad}`);
  }
  assert.equal((globalThis as Record<string, unknown>).__pwned, false);
});

test("globoko gnezdenje ne sproži prekoračitve sklada", () => {
  const deep = "(".repeat(5000) + "1" + ")".repeat(5000);
  assert.equal(evaluateFormula(deep, {}), 0);
});

test("formule se lahko sklicujejo na druge formule", () => {
  const map = buildFormulaMap([
    { key: "toplotna", sourceType: "formula", formula: "{og} + {san}" },
    { key: "gosp", sourceType: "formula", formula: "{skupna} - {avto} - {toplotna}" },
    { key: "og", sourceType: "melcloud", formula: null },
  ]);
  const day = { og: 5, san: 2, skupna: 20, avto: 3 };
  assert.equal(evaluateFormula(map.gosp, day, map), 20 - 3 - 7);
  // brez mape se formulirani stolpec obravnava kot manjkajoč (0)
  assert.equal(evaluateFormula(map.gosp, day), 17);
});

test("krožni sklici ne povzročijo neskončne rekurzije", () => {
  const map = { a: "{b} + 1", b: "{a} + 1" };
  assert.doesNotThrow(() => evaluateFormula("{a}", {}, map));
  assert.equal(typeof evaluateFormula("{a}", {}, map), "number");
});

test("extractFormulaKeys", () => {
  assert.deepEqual(extractFormulaKeys("{a} + {b_c} * 2"), ["a", "b_c"]);
  assert.deepEqual(extractFormulaKeys("1 + 2"), []);
});

test("validateFormula: sintaksa, neznani stolpci, cikli", () => {
  assert.equal(validateFormula("{a} + {b}", { knownKeys: ["a", "b"] }), null);
  assert.match(validateFormula("{a} +", {}) ?? "", /./);
  assert.match(validateFormula("{x} + 1", { knownKeys: ["a"] }) ?? "", /Neznan stolpec/);
  assert.match(validateFormula("{a} ^ 2", {}) ?? "", /Nedovoljen znak/);
  // a = b + 1, b = a + 1 -> cikel
  assert.match(
    validateFormula("{b} + 1", { ownKey: "a", formulaMap: { b: "{a} + 1" }, knownKeys: ["a", "b"] }) ?? "",
    /krožni/
  );
  // sklic na samega sebe
  assert.match(validateFormula("{a} + 1", { ownKey: "a", knownKeys: ["a"] }) ?? "", /krožni/);
  assert.equal(validateFormula("{b} + 1", { ownKey: "a", formulaMap: { b: "2" }, knownKeys: ["a", "b"] }), null);
});

test("seed formule iz aplikacije se izračunajo pravilno", () => {
  const cols = [
    { key: "toplotna", sourceType: "formula", formula: "{toplotna_ogrevanje} + {toplotna_sanitarna}" },
    { key: "gospodinjstvo", sourceType: "formula", formula: "{skupna_poraba} - {avto} - {toplotna_ogrevanje} - {toplotna_sanitarna}" },
    { key: "visek_manjko", sourceType: "formula", formula: "{solarna} - {skupna_poraba}" },
  ];
  const map = buildFormulaMap(cols);
  const day = { toplotna_ogrevanje: 4, toplotna_sanitarna: 1.5, avto: 6, skupna_poraba: 30, solarna: 12 };
  assert.equal(evaluateFormula(map.toplotna, day, map), 5.5);
  assert.equal(evaluateFormula(map.gospodinjstvo, day, map), 30 - 6 - 4 - 1.5);
  assert.equal(evaluateFormula(map.visek_manjko, day, map), -18);
});
