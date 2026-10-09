/**
 * Varen evaluator formul brez eval/new Function.
 *
 * Podpira: števila, {kljuc_stolpca}, + - * /, unarni minus/plus in oklepaje.
 * Formule se lahko sklicujejo tudi na druge formule (stolpce) – za to podaj
 * `formulaMap` (key -> formula). Cikli in deljenje z 0 vrnejo 0.
 *
 * Primer: "{toplotna_ogrevanje} + {toplotna_sanitarna}"
 */

type Ast =
  | { k: "num"; v: number }
  | { k: "key"; v: string }
  | { k: "neg"; a: Ast }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: Ast; b: Ast };

type Token =
  | { t: "num"; v: number }
  | { t: "key"; v: string }
  | { t: "op"; v: string };

const MAX_DEPTH = 50;
const MAX_LENGTH = 2000;

function tokenize(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "{") {
      const end = src.indexOf("}", i + 1);
      if (end === -1) return "Manjka zaključni '}'";
      const key = src.slice(i + 1, end).trim();
      if (!key || key.includes("{")) return "Neveljaven sklic na stolpec";
      out.push({ t: "key", v: key });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) return `Neveljavno število pri znaku ${i + 1}`;
      out.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    return `Nedovoljen znak '${ch}' pri znaku ${i + 1}`;
  }
  return out;
}

export function parseFormula(src: string): { ok: true; ast: Ast } | { ok: false; error: string } {
  if (typeof src !== "string" || !src.trim()) return { ok: false, error: "Formula je prazna" };
  if (src.length > MAX_LENGTH) return { ok: false, error: "Formula je predolga" };
  const tokens = tokenize(src);
  if (typeof tokens === "string") return { ok: false, error: tokens };

  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];

  const parseExpr = (): Ast => {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
        pos++;
        const right = parseTerm();
        left = { k: "bin", op: t.v, a: left, b: right };
      } else break;
    }
    return left;
  };
  const parseTerm = (): Ast => {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        pos++;
        const right = parseUnary();
        left = { k: "bin", op: t.v, a: left, b: right };
      } else break;
    }
    return left;
  };
  const parseUnary = (): Ast => {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      pos++;
      if (++depth > MAX_DEPTH) throw new Error("Preveč gnezdenja");
      const a = parseUnary();
      depth--;
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return parsePrimary();
  };
  const parsePrimary = (): Ast => {
    const t = peek();
    if (!t) throw new Error("Nepričakovan konec formule");
    if (t.t === "num") { pos++; return { k: "num", v: t.v }; }
    if (t.t === "key") { pos++; return { k: "key", v: t.v }; }
    if (t.t === "op" && t.v === "(") {
      pos++;
      if (++depth > MAX_DEPTH) throw new Error("Preveč gnezdenja");
      const e = parseExpr();
      depth--;
      const close = peek();
      if (!close || close.t !== "op" || close.v !== ")") throw new Error("Manjka ')'");
      pos++;
      return e;
    }
    throw new Error(`Nepričakovan simbol '${t.v}'`);
  };

  try {
    const ast = parseExpr();
    if (pos < tokens.length) throw new Error(`Nepričakovan simbol '${(tokens[pos] as { v: unknown }).v}'`);
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Napaka v formuli" };
  }
}

// Cache razčlenjenih formul (odjemalec jih kliče tisočkrat)
const astCache = new Map<string, Ast | null>();
function getAst(formula: string): Ast | null {
  if (astCache.has(formula)) return astCache.get(formula)!;
  const r = parseFormula(formula);
  if (astCache.size > 500) astCache.clear();
  astCache.set(formula, r.ok ? r.ast : null);
  return r.ok ? r.ast : null;
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

function evalAst(ast: Ast, getValue: (key: string) => number): number {
  switch (ast.k) {
    case "num": return ast.v;
    case "key": return getValue(ast.v);
    case "neg": return -evalAst(ast.a, getValue);
    case "bin": {
      const a = evalAst(ast.a, getValue);
      const b = evalAst(ast.b, getValue);
      switch (ast.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b;
      }
    }
  }
}

/** Zgradi mapo key -> formula iz seznama stolpcev. */
export function buildFormulaMap(
  cols: Array<{ key: string; sourceType: string; formula: string | null }>
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of cols) {
    if (c.sourceType === "formula" && c.formula) m[c.key] = c.formula;
  }
  return m;
}

/**
 * Izračuna formulo. `values` so surove dnevne vrednosti (key -> število).
 * `formulaMap` omogoča sklice na druge formulirane stolpce.
 */
export function evaluateFormula(
  formula: string,
  values: Record<string, number>,
  formulaMap: Record<string, string> = {}
): number {
  const ast = getAst(formula);
  if (!ast) return 0;

  const resolve = (key: string, stack: string[]): number => {
    const sub = formulaMap[key];
    if (sub !== undefined) {
      if (stack.includes(key) || stack.length > 20) return 0;
      const subAst = getAst(sub);
      if (!subAst) return 0;
      return finite(evalAst(subAst, (k) => resolve(k, [...stack, key])));
    }
    const v = values[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  return finite(evalAst(ast, (k) => resolve(k, [])));
}

/** Vrne ključe, na katere se formula sklicuje. */
export function extractFormulaKeys(formula: string): string[] {
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1).trim());
}

/**
 * Preveri formulo: sintaksa, neznani stolpci in cikli.
 * Vrne sporočilo o napaki ali null, če je formula v redu.
 */
export function validateFormula(
  formula: string,
  opts: { knownKeys?: string[]; ownKey?: string; formulaMap?: Record<string, string> } = {}
): string | null {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return parsed.error;

  const keys = extractFormulaKeys(formula);
  if (opts.knownKeys) {
    const known = new Set(opts.knownKeys);
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) return `Neznan stolpec: ${unknown.map((k) => `{${k}}`).join(", ")}`;
  }

  if (opts.ownKey) {
    const graph: Record<string, string> = { ...(opts.formulaMap || {}), [opts.ownKey]: formula };
    const visiting = new Set<string>();
    const done = new Set<string>();
    const dfs = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (done.has(node)) return false;
      visiting.add(node);
      const f = graph[node];
      if (f) for (const dep of extractFormulaKeys(f)) if (dfs(dep)) return true;
      visiting.delete(node);
      done.add(node);
      return false;
    };
    if (dfs(opts.ownKey)) return "Formula povzroča krožni sklic";
  }
  return null;
}
