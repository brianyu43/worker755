// Shell arithmetic, as in $(( … )), (( … )), let and array subscripts: 64-bit signed integers with C's
// operators, variables by name, and assignment.

export class ArithError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArithError';
  }
}

export interface ArithEnv {
  get(name: string, index: string | null): string;
  set(name: string, index: string | null, value: string): void;
}

const MAX_RECURSION = 64;

type Tok = { t: 'num'; v: bigint } | { t: 'id'; name: string; index: string | null } | { t: 'op'; v: string } | { t: 'end' };

const OPS = ['<<=', '>>=', '**', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=',
  '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '^', '|', '?', ':', '=', ',', '(', ')'];

const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

function parseNumber(text: string, source: string): bigint {
  let m = /^0[xX]([0-9a-fA-F]+)$/.exec(text);
  if (m) return wrap(BigInt('0x' + m[1]));
  m = /^(\d+)#([0-9a-zA-Z@_]+)$/.exec(text);
  if (m) {
    const base = Number(m[1]);
    if (base < 2 || base > 64) throw new ArithError(`${source}: invalid arithmetic base (error token is "${text}")`);
    let v = 0n;
    for (const ch of m[2]) {
      let d: number;
      if (/[0-9]/.test(ch)) d = ch.charCodeAt(0) - 48;
      else if (/[a-z]/.test(ch)) d = ch.charCodeAt(0) - 97 + 10;
      else if (/[A-Z]/.test(ch)) d = base <= 36 ? ch.charCodeAt(0) - 65 + 10 : ch.charCodeAt(0) - 65 + 36;
      else d = ch === '@' ? 62 : 63;
      if (d >= base) throw new ArithError(`${source}: value too great for base (error token is "${text}")`);
      v = wrap(v * BigInt(base) + BigInt(d));
    }
    return v;
  }
  if (/^0[0-7]+$/.test(text)) return wrap(BigInt('0o' + text.slice(1)));
  if (/^\d+$/.test(text)) {
    if (/^0\d/.test(text)) throw new ArithError(`${source}: value too great for base (error token is "${text}")`);
    return wrap(BigInt(text));
  }
  throw new ArithError(`${source}: value too great for base (error token is "${text}")`);
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+#[0-9a-zA-Z@_]+|^0[xX][0-9a-fA-F]*|^[0-9a-zA-Z_]+/.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseNumber(m[0], src) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      i += m[0].length;
      let index: string | null = null;
      if (src[i] === '[') {
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === '[') depth++;
          else if (src[j] === ']' && --depth === 0) break;
        }
        if (j >= src.length) throw new ArithError(`${src}: bad array subscript`);
        index = src.slice(i + 1, j);
        i = j + 1;
      }
      out.push({ t: 'id', name: m[0], index });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ArithError(`${src}: syntax error: invalid arithmetic operator (error token is "${src.slice(i)}")`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

const BINARY: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11,
};

const ASSIGN = new Set(['=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '&=', '^=', '|=']);

/** A value in the middle of evaluation: a number, or a variable that can still be assigned to. */
type Val = { v: bigint; ref?: { name: string; index: string | null } };

class Evaluator {
  private toks: Tok[];
  private pos = 0;
  private src: string;
  private env: ArithEnv;
  private depth: number;
  /** Evaluation off: the untaken side of && || ?: is parsed but has no effects. */
  private skip = 0;

  constructor(src: string, env: ArithEnv, depth: number) {
    this.src = src;
    this.toks = tokenize(src);
    this.env = env;
    this.depth = depth;
  }

  private peek(): Tok {
    return this.toks[this.pos];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }

  private errorToken(): string {
    const rest = this.toks.slice(this.pos).filter((t) => t.t !== 'end');
    return rest.map((t) => (t.t === 'num' ? String(t.v) : t.t === 'id' ? t.name : t.t === 'op' ? t.v : '')).join(' ');
  }

  private syntax(): ArithError {
    const tok = this.errorToken();
    return new ArithError(`${this.src.trim()}: syntax error: ${tok ? 'invalid arithmetic operator' : 'operand expected'} (error token is "${tok}")`);
  }

  run(): bigint {
    if (this.peek().t === 'end') return 0n;
    const v = this.comma();
    if (this.peek().t !== 'end') throw this.syntax();
    return this.value(v);
  }

  private value(v: Val): bigint {
    if (!v.ref) return v.v;
    if (this.skip) return 0n;
    return this.lookup(v.ref.name, v.ref.index);
  }

  private lookup(name: string, index: string | null): bigint {
    const raw = this.env.get(name, index === null ? null : String(this.subscript(index))).trim();
    if (raw === '') return 0n;
    if (/^-?\d+$/.test(raw)) return wrap(BigInt(raw));
    if (this.depth >= MAX_RECURSION) throw new ArithError(`${raw}: expression recursion level exceeded (error token is "${raw}")`);
    return new Evaluator(raw, this.env, this.depth + 1).run();
  }

  private subscript(index: string): bigint {
    if (/^-?\d+$/.test(index.trim())) return BigInt(index.trim());
    return new Evaluator(index, this.env, this.depth + 1).run();
  }

  private assign(ref: Val['ref'], v: bigint): void {
    if (!ref) throw new ArithError(`${this.src.trim()}: attempted assignment to non-variable (error token is "${this.errorToken()}")`);
    if (this.skip) return;
    this.env.set(ref.name, ref.index === null ? null : String(this.subscript(ref.index)), String(v));
  }

  private comma(): Val {
    let v = this.assignment();
    while (this.isOp(',')) {
      this.pos++;
      this.value(v);
      v = this.assignment();
    }
    return v;
  }

  private assignment(): Val {
    const left = this.ternary();
    const t = this.peek();
    if (t.t === 'op' && ASSIGN.has(t.v)) {
      this.pos++;
      const right = this.value(this.assignment());
      let v = right;
      if (t.v !== '=') v = this.binary(t.v.slice(0, -1), this.value(left), right);
      this.assign(left.ref, v);
      return { v };
    }
    return left;
  }

  private ternary(): Val {
    const cond = this.binaryLevel(1);
    if (!this.isOp('?')) return cond;
    this.pos++;
    const c = this.value(cond);
    if (!c) this.skip++;
    const a = this.value(this.assignment());
    if (!c) this.skip--;
    if (!this.isOp(':')) throw this.syntax();
    this.pos++;
    if (c) this.skip++;
    const b = this.value(this.assignment());
    if (c) this.skip--;
    return { v: c ? a : b };
  }

  private binaryLevel(min: number): Val {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      const prec = BINARY[t.v];
      if (prec === undefined || prec < min) break;
      this.pos++;
      if (t.v === '&&' || t.v === '||') {
        const l = this.value(left);
        const short = t.v === '&&' ? !l : !!l;
        if (short) this.skip++;
        const r = this.value(this.binaryLevel(prec + 1));
        if (short) this.skip--;
        left = { v: t.v === '&&' ? (l && r ? 1n : 0n) : l || r ? 1n : 0n };
        continue;
      }
      // ** is right-associative.
      const right = this.value(this.binaryLevel(t.v === '**' ? prec : prec + 1));
      left = { v: this.binary(t.v, this.value(left), right) };
    }
    return left;
  }

  private binary(op: string, a: bigint, b: bigint): bigint {
    if (this.skip) return 0n;
    switch (op) {
      case '+': return wrap(a + b);
      case '-': return wrap(a - b);
      case '*': return wrap(a * b);
      case '/':
      case '%':
        if (b === 0n) throw new ArithError(`${this.src.trim()}: division by 0 (error token is "${this.errorToken() || String(b)}")`);
        return wrap(op === '/' ? a / b : a % b);
      case '**':
        if (b < 0n) throw new ArithError(`${this.src.trim()}: exponent less than 0 (error token is "${String(b)}")`);
        return wrap(powMod(a, b));
      case '<<': return wrap(a << (b & 63n));
      case '>>': return wrap(a >> (b & 63n));
      case '<': return a < b ? 1n : 0n;
      case '>': return a > b ? 1n : 0n;
      case '<=': return a <= b ? 1n : 0n;
      case '>=': return a >= b ? 1n : 0n;
      case '==': return a === b ? 1n : 0n;
      case '!=': return a !== b ? 1n : 0n;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
    }
    throw this.syntax();
  }

  private unary(): Val {
    const t = this.peek();
    if (t.t === 'op') {
      switch (t.v) {
        case '+': this.pos++; return { v: this.value(this.unary()) };
        case '-': this.pos++; return { v: wrap(-this.value(this.unary())) };
        case '!': this.pos++; return { v: this.value(this.unary()) ? 0n : 1n };
        case '~': this.pos++; return { v: wrap(~this.value(this.unary())) };
        case '++':
        case '--': {
          this.pos++;
          const target = this.unary();
          const v = wrap(this.value(target) + (t.v === '++' ? 1n : -1n));
          this.assign(target.ref, v);
          return { v };
        }
      }
    }
    return this.postfix();
  }

  private postfix(): Val {
    const v = this.primary();
    const t = this.peek();
    if (t.t === 'op' && (t.v === '++' || t.v === '--') && v.ref) {
      this.pos++;
      const old = this.value(v);
      this.assign(v.ref, wrap(old + (t.v === '++' ? 1n : -1n)));
      return { v: old };
    }
    return v;
  }

  private primary(): Val {
    const t = this.peek();
    if (t.t === 'num') {
      this.pos++;
      return { v: t.v };
    }
    if (t.t === 'id') {
      this.pos++;
      return { v: 0n, ref: { name: t.name, index: t.index } };
    }
    if (t.t === 'op' && t.v === '(') {
      this.pos++;
      const v = this.value(this.comma());
      if (!this.isOp(')')) throw this.syntax();
      this.pos++;
      return { v };
    }
    throw this.syntax();
  }
}

function powMod(a: bigint, b: bigint): bigint {
  let result = 1n;
  let base = a;
  let e = b;
  while (e > 0n) {
    if (e & 1n) result = wrap(result * base);
    base = wrap(base * base);
    e >>= 1n;
  }
  return result;
}

/** Evaluate an arithmetic expression. Throws ArithError with bash's wording (without the `bash: ` prefix). */
export function evaluate(src: string, env: ArithEnv): bigint {
  return new Evaluator(src, env, 0).run();
}
