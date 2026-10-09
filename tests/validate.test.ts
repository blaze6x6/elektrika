import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysStr, csvCell, daysBetweenInclusive, daysInMonth, escapeHtml, isValidDate, isValidMonth, isValidUsername,
  isValidYear, monthRange, parseId, parseLocaleNumber, previousMonth, safeFilenamePart, toFiniteNumber,
  validatePassword, yesterdayLocalStr,
} from "../src/lib/validate.ts";

test("datumi: veljavnost (vključno z nepravimi dnevi)", () => {
  assert.ok(isValidDate("2026-10-08"));
  assert.ok(isValidDate("2028-02-29")); // prestopno leto
  assert.ok(!isValidDate("2027-02-29"));
  assert.ok(!isValidDate("2026-02-30"));
  assert.ok(!isValidDate("2026-13-01"));
  assert.ok(!isValidDate("08.10.2026"));
  assert.ok(!isValidDate("2026-10-08; DROP TABLE"));
  assert.ok(!isValidDate(20261008));
  assert.ok(!isValidDate("1999-01-01"));
});

test("meseci in leta", () => {
  assert.ok(isValidMonth("2026-10"));
  assert.ok(!isValidMonth("2026-00"));
  assert.ok(!isValidMonth("2026-13"));
  assert.ok(!isValidMonth("2026-1"));
  assert.ok(!isValidMonth("2026-10&api_key=x"));
  assert.ok(isValidYear("2026"));
  assert.ok(!isValidYear("26"));
  assert.ok(!isValidYear("99999"));
});

test("monthRange, daysInMonth, previousMonth", () => {
  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(previousMonth("2026-03"), "2026-02");
});

test("addDaysStr, daysBetweenInclusive", () => {
  assert.equal(addDaysStr("2026-02-28", 1), "2026-03-01");
  assert.equal(addDaysStr("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetweenInclusive("2026-10-01", "2026-10-31"), 31);
  assert.equal(daysBetweenInclusive("2026-10-01", "2026-10-01"), 1);
  // prehod na zimski čas (UTC aritmetika) ne spremeni števila dni
  assert.equal(daysBetweenInclusive("2026-10-24", "2026-10-26"), 3);
});

test("yesterdayLocalStr čez mejo meseca/leta (lokalni čas, ne UTC)", () => {
  assert.equal(yesterdayLocalStr(new Date(2026, 10, 1, 4, 0, 0)), "2026-10-31");
  assert.equal(yesterdayLocalStr(new Date(2027, 0, 1, 0, 30, 0)), "2026-12-31");
  assert.equal(yesterdayLocalStr(new Date(2028, 2, 1, 4, 0, 0)), "2028-02-29");
});

test("parseLocaleNumber: slovenska in angleška oblika", () => {
  assert.equal(parseLocaleNumber("12,5"), 12.5);
  assert.equal(parseLocaleNumber("12.5"), 12.5);
  assert.equal(parseLocaleNumber("1.234,56"), 1234.56);
  assert.equal(parseLocaleNumber("1,234.56"), 1234.56);
  assert.equal(parseLocaleNumber("-3,2"), -3.2);
  assert.equal(parseLocaleNumber("  7 "), 7);
  assert.equal(parseLocaleNumber("1 234,5"), 1234.5);
  for (const bad of ["", "abc", "1e5", "1.2.3", "1,2,3", "--1", "Infinity", "NaN", "12abc", "0x10"]) {
    assert.equal(parseLocaleNumber(bad), null, bad);
  }
});

test("toFiniteNumber", () => {
  assert.equal(toFiniteNumber(5), 5);
  assert.equal(toFiniteNumber("5,5"), 5.5);
  assert.equal(toFiniteNumber(NaN), null);
  assert.equal(toFiniteNumber(Infinity), null);
  assert.equal(toFiniteNumber(1e12), null);
  assert.equal(toFiniteNumber({}), null);
  assert.equal(toFiniteNumber(null), null);
});

test("parseId", () => {
  assert.equal(parseId("12"), 12);
  assert.equal(parseId(7), 7);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("1; DROP"), null);
  assert.equal(parseId(1.5), null);
  assert.equal(parseId(99999999999), null);
});

test("uporabniško ime in geslo", () => {
  assert.ok(isValidUsername("matjaz.k@moj-svet.si"));
  assert.ok(!isValidUsername("ab"));
  assert.ok(!isValidUsername("a b c"));
  assert.ok(!isValidUsername("<script>"));
  assert.equal(validatePassword("dovolj-dolgo-geslo"), null);
  assert.match(validatePassword("kratko") ?? "", /vsaj 10/);
  assert.match(validatePassword("a".repeat(80)) ?? "", /predolgo|preprosto/);
  assert.match(validatePassword("šššššššššššššššššššššššššššššššššššššš1") ?? "", /predolgo/); // 72 bajtov
  assert.match(validatePassword("aaaaaaaaaaaa") ?? "", /preprosto/);
  assert.match(validatePassword("adminadmin") ?? "", /pogosto/);
  assert.match(validatePassword(undefined) ?? "", /obvezno/);
});

test("escapeHtml prepreči vrivanje značk", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml("a & b 'c'"), "a &amp; b &#39;c&#39;");
  assert.equal(escapeHtml(null), "");
});

test("csvCell: formula-injection in citiranje", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("a;b"), `"a;b"`);
  assert.equal(csvCell("normalno"), "normalno");
});

test("safeFilenamePart", () => {
  assert.equal(safeFilenamePart('2026-01-01"\r\nX: y'), "2026-01-01___X__y");
});
