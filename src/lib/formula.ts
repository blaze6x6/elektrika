/**
 * Evaluate a formula string by replacing {column_key} references with numeric values.
 * Only allows basic arithmetic: + - * / ( ) and numbers.
 *
 * Example formula: "{toplotna_ogrevanje} + {toplotna_sanitarna}"
 */
export function evaluateFormula(
  formula: string,
  values: Record<string, number>
): number {
  // Replace {key} placeholders with their numeric values
  let expr = formula.replace(/\{([^}]+)\}/g, (_, key) => {
    const v = values[key.trim()];
    return String(v ?? 0);
  });

  // Sanitize: only allow digits, whitespace, basic operators, parens, dots, minus
  if (!/^[\d\s+\-*/().]+$/.test(expr)) {
    return 0;
  }

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    return typeof result === "number" && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

/**
 * Extract column keys referenced in a formula.
 * e.g. "{a} + {b}" => ["a", "b"]
 */
export function extractFormulaKeys(formula: string): string[] {
  const matches = formula.match(/\{([^}]+)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1).trim());
}
