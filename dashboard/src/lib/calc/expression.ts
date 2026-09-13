// Safe arithmetic for the calculator keypad (no eval): numbers, + − × ÷ (also * / -), ^, postfix %, parentheses.
//   expr    := term (("+" | "-") term)*
//   term    := unary (("*" | "/") unary)*
//   unary   := ("-" | "+") unary | power
//   power   := postfix ("^" unary)?          so -2^2 = -(2^2)
//   postfix := primary "%"*                  50% = 0.5
//   primary := number | "(" expr ")"

export type EvalResult = { ok: true; value: number } | { ok: false; error: string };

type Token = { kind: "num"; value: number } | { kind: "op"; value: string } | { kind: "open" } | { kind: "close" };

function tokenize(source: string): Token[] | null {
  const s = source.replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/,/g, "").replace(/\s+/g, "");
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const text = s.slice(i, j);
      if ((text.match(/\./g) ?? []).length > 1 || text === ".") return null;
      tokens.push({ kind: "num", value: parseFloat(text) });
      i = j;
    } else if ("+-*/^%".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
    } else if (c === "(") {
      tokens.push({ kind: "open" });
      i++;
    } else if (c === ")") {
      tokens.push({ kind: "close" });
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

export function evaluateExpression(source: string): EvalResult {
  if (!source.trim()) return { ok: false, error: "Nothing to calculate" };
  const tokens = tokenize(source);
  if (!tokens) return { ok: false, error: "Unknown character" };
  let p = 0;

  const isOp = (op: string) => {
    const t = tokens[p];
    return t?.kind === "op" && t.value === op;
  };
  const takeOp = () => (tokens[p++] as { kind: "op"; value: string }).value;

  const expr = (): number => {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const op = takeOp();
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = unary();
    while (isOp("*") || isOp("/")) {
      const op = takeOp();
      const right = unary();
      if (op === "/" && right === 0) throw new Error("Can’t divide by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  const unary = (): number => {
    if (isOp("-")) {
      p++;
      return -unary();
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = postfix();
    if (isOp("^")) {
      p++;
      return base ** unary();
    }
    return base;
  };
  const postfix = (): number => {
    let value = primary();
    while (isOp("%")) {
      p++;
      value /= 100;
    }
    return value;
  };
  const primary = (): number => {
    const t = tokens[p++];
    if (!t) throw new Error("Incomplete expression");
    if (t.kind === "num") return t.value;
    if (t.kind === "open") {
      const value = expr();
      if (tokens[p]?.kind !== "close") throw new Error("Missing )");
      p++;
      return value;
    }
    throw new Error("Unexpected symbol");
  };

  try {
    const value = expr();
    if (p !== tokens.length) return { ok: false, error: "Unexpected symbol" };
    if (!Number.isFinite(value)) return { ok: false, error: "Out of range" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid expression" };
  }
}

/** A result as plain digits the parser can read back in (no grouping, no exponent for normal magnitudes). */
export function toPlainNumber(value: number): string {
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 });
}
