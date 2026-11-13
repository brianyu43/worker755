// awk: a POSIX awk with the common gawk additions (tolower/toupper, length(arr), regex RS, delete arr,
// FS=""). Programs run in memory against the shell's files; every loop turn and statement counts against
// the command line's budget, and strings and arrays have caps, so no program can hang or eat the tab.

import type { Command, CommandContext } from './context.ts';
import { abs, fail, msgOf, usage } from './context.ts';
import { posixToJs, readInput } from './text.ts';
import { errorText } from '../vfs.ts';

/** Longest string a program may build. */
const MAX_STRING = 4_000_000;
/** Most array elements a program may hold, all arrays together. */
const MAX_ELEMENTS = 500_000;

// ---- values ------------------------------------------------------------------------------

/** A string from input (fields, getline, ARGV, -v) that counts as a number when it looks like one. */
class StrNum {
  readonly s: string;
  readonly n: number | null;
  constructor(s: string, n: number | null) {
    this.s = s;
    this.n = n;
  }
}
type Val = number | string | StrNum;

const UNINIT = new StrNum('', 0);
const NUMERIC = /^[ \t\n]*[-+]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|inf(?:inity)?|nan)[ \t\n]*$/i;

function strnum(s: string): StrNum {
  return new StrNum(s, NUMERIC.test(s) ? Number(s.trim().replace(/^\+/, '')) : null);
}

/** strtod-style: the longest numeric prefix, 0 when there is none. */
function prefixNumber(s: string): number {
  const m = /^[ \t\n]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s);
  if (m) return Number(m[1]);
  if (/^[ \t\n]*[-+]?0x[0-9a-f]+/i.test(s)) return 0;
  return 0;
}

// ---- lexer -------------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 're'; v: string }
  | { t: 'name'; v: string }
  | { t: 'func'; v: string } // a name directly followed by '('
  | { t: 'builtin'; v: string }
  | { t: 'kw'; v: string }
  | { t: 'op'; v: string }
  | { t: 'nl' }
  | { t: 'eof' };

const KEYWORDS = new Set([
  'BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'nextfile',
  'exit', 'return', 'delete', 'in', 'getline', 'print', 'printf',
]);
const BUILTINS = new Set([
  'length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt',
  'int', 'rand', 'srand', 'tolower', 'toupper', 'system', 'close', 'fflush',
]);
const OPS = [
  '+=', '-=', '*=', '/=', '%=', '^=', '**=', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '>>', '!~', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '>', '<', '|', '?', ':', '~', '$', '=',
];

class AwkError extends Error {}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  /** A '/' starts a regex unless the previous token ends an operand. */
  const regexAllowed = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 'name' || p.t === 're') return false;
    if (p.t === 'builtin') return false;
    if (p.t === 'op' && (p.v === ')' || p.v === ']' || p.v === '$' || p.v === '++' || p.v === '--')) return false;
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') {
      i += 3;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      toks.push({ t: 'nl' });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && /^(?:\d|\.\d)/.test(src.slice(i, i + 2))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const w = m[0];
      i += w.length;
      if (KEYWORDS.has(w)) toks.push({ t: 'kw', v: w === 'func' ? 'function' : w });
      else if (BUILTINS.has(w)) toks.push({ t: 'builtin', v: w });
      else if (src[i] === '(') toks.push({ t: 'func', v: w });
      else toks.push({ t: 'name', v: w });
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') throw new AwkError('newline in string');
        if (src[i] === '\\' && i + 1 < src.length) {
          const e = src[i + 1];
          i += 2;
          const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b', f: '\f', v: '\v' };
          if (e in simple) s += simple[e];
          else if (/[0-7]/.test(e)) {
            const m = /^[0-7]{1,3}/.exec(src.slice(i - 1))!;
            s += String.fromCharCode(parseInt(m[0], 8));
            i += m[0].length - 1;
          } else if (e === '\n') continue;
          else s += '\\' + e;
          continue;
        }
        s += src[i++];
      }
      if (i >= src.length) throw new AwkError('non-terminated string');
      i++;
      toks.push({ t: 'str', v: s });
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let s = '';
      i++;
      let inBracket = false;
      while (i < src.length && (src[i] !== '/' || inBracket)) {
        if (src[i] === '\n') throw new AwkError('newline in regex');
        if (src[i] === '\\' && i + 1 < src.length) {
          s += src[i + 1] === '/' ? '/' : src[i] + src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === '[' && !inBracket) {
          inBracket = true;
          s += src[i++];
          if (src[i] === '^') s += src[i++];
          if (src[i] === ']') s += src[i++];
          continue;
        }
        if (src[i] === ']' && inBracket) inBracket = false;
        s += src[i++];
      }
      if (i >= src.length) throw new AwkError('non-terminated regular expression');
      i++;
      toks.push({ t: 're', v: s });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new AwkError(`syntax error at source line 1: unexpected character '${c}'`);
    toks.push({ t: 'op', v: op === '**' ? '^' : op === '**=' ? '^=' : op });
    i += op.length;
  }
  toks.push({ t: 'eof' });
  return toks;
}

// ---- syntax tree -------------------------------------------------------------------------

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 're'; re: RegExp }
  | { k: 'var'; name: string }
  | { k: 'field'; e: Expr }
  | { k: 'index'; name: string; subs: Expr[] }
  | { k: 'assign'; op: string; target: Expr; e: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'in'; subs: Expr[]; name: string }
  | { k: 'match'; neg: boolean; a: Expr; re: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'cmp'; op: string; a: Expr; b: Expr }
  | { k: 'concat'; a: Expr; b: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'neg' | 'plus'; e: Expr }
  | { k: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'builtin'; name: string; args: Expr[] }
  | { k: 'getline'; target: Expr | null; file: Expr | null; cmd: Expr | null }
  | { k: 'group'; e: Expr };

type Redirect = { op: '>' | '>>' | '|'; e: Expr } | null;

type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'print'; args: Expr[]; redirect: Redirect }
  | { k: 'printf'; args: Expr[]; redirect: Redirect }
  | { k: 'if'; c: Expr; then: Stmt; else: Stmt | null }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; c: Expr; body: Stmt }
  | { k: 'for'; init: Stmt | null; c: Expr | null; step: Stmt | null; body: Stmt }
  | { k: 'forin'; v: string; arr: string; body: Stmt }
  | { k: 'block'; body: Stmt[] }
  | { k: 'next' | 'nextfile' | 'break' | 'continue' }
  | { k: 'exit' | 'return'; e: Expr | null }
  | { k: 'delete'; name: string; subs: Expr[] | null };

interface Rule {
  kind: 'begin' | 'end' | 'main';
  pattern: Expr | null;
  pattern2: Expr | null;
  action: Stmt[] | null; // null: print $0
  inRange?: boolean;
}

interface Func {
  params: string[];
  body: Stmt[];
}

interface Program {
  rules: Rule[];
  funcs: Map<string, Func>;
}

function compileRegex(src: string): RegExp {
  try {
    return new RegExp(posixToJs(src.replace(/\\\//g, '/'), true));
  } catch {
    throw new AwkError(`regular expression /${src}/: invalid`);
  }
}

// ---- parser ------------------------------------------------------------------------------

function parse(src: string): Program {
  const toks = lex(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const isOp = (v: string, o = 0) => {
    const t = toks[p + o];
    return t.t === 'op' && t.v === v;
  };
  const isKw = (v: string) => {
    const t = toks[p];
    return t.t === 'kw' && t.v === v;
  };
  const describe = (t: Tok): string => {
    if (t.t === 'eof') return 'end of program';
    if (t.t === 'nl') return 'newline';
    return String(t.v);
  };
  const error = (): never => {
    throw new AwkError(`syntax error at source line 1 near ${describe(peek())}`);
  };
  const expectOp = (v: string) => {
    if (!isOp(v)) error();
    p++;
  };
  const nls = () => {
    while (peek().t === 'nl') p++;
  };
  const terminators = () => {
    while (peek().t === 'nl' || isOp(';')) p++;
  };

  const rules: Rule[] = [];
  const funcs = new Map<string, Func>();

  // Expressions, lowest precedence first. `noGt` stops at '>' inside print arguments; `noIn` inside for(;;) init.
  let noGt = 0;
  let noIn = 0;
  const lvalue = (e: Expr): boolean => e.k === 'var' || e.k === 'field' || e.k === 'index';

  const expr = (): Expr => ternary();
  const ternary = (): Expr => {
    const c = orE();
    if (isOp('?')) {
      p++;
      nls();
      const a = ternary();
      nls();
      expectOp(':');
      nls();
      const b = ternary();
      return { k: 'cond', c, a, b };
    }
    if (peek().t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes((peek() as { v: string }).v) && lvalue(c)) {
      const op = (peek() as { v: string }).v;
      p++;
      nls();
      return { k: 'assign', op, target: c, e: ternary() };
    }
    return c;
  };
  const orE = (): Expr => {
    let a = andE();
    while (isOp('||')) {
      p++;
      nls();
      a = { k: 'or', a, b: andE() };
    }
    return a;
  };
  const andE = (): Expr => {
    let a = inE();
    while (isOp('&&')) {
      p++;
      nls();
      a = { k: 'and', a, b: inE() };
    }
    return a;
  };
  const inE = (): Expr => {
    let a = matchE();
    while (isKw('in') && !noIn) {
      p++;
      const t = peek();
      if (t.t !== 'name') error();
      p++;
      a = { k: 'in', subs: [a], name: (t as { v: string }).v };
    }
    return a;
  };
  const matchE = (): Expr => {
    let a = cmpE();
    while (isOp('~') || isOp('!~')) {
      const neg = isOp('!~');
      p++;
      a = { k: 'match', neg, a, re: cmpE() };
    }
    return a;
  };
  const cmpE = (): Expr => {
    const a = concatE();
    const t = peek();
    if (t.t === 'op' && ['<', '<=', '!=', '==', '>=', '>'].includes(t.v)) {
      if (t.v === '>' && noGt) return a;
      p++;
      return { k: 'cmp', op: t.v, a, b: concatE() };
    }
    return a;
  };
  const startsOperand = (): boolean => {
    const t = peek();
    if (t.t === 'num' || t.t === 'str' || t.t === 're' || t.t === 'name' || t.t === 'func' || t.t === 'builtin') return true;
    return t.t === 'op' && ['$', '(', '-', '+', '++', '--'].includes(t.v);
  };
  const concatE = (): Expr => {
    let a = addE();
    while (startsOperand() && !isOp('-') && !isOp('+')) a = { k: 'concat', a, b: addE() };
    // `cmd | getline [var]`
    while (isOp('|') && peek(1).t === 'kw' && (peek(1) as { v: string }).v === 'getline') {
      p += 2;
      const target = optLvalue();
      a = { k: 'getline', target, file: null, cmd: a };
    }
    return a;
  };
  const addE = (): Expr => {
    let a = mulE();
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { v: string }).v;
      p++;
      a = { k: 'bin', op, a, b: mulE() };
    }
    return a;
  };
  const mulE = (): Expr => {
    let a = unaryE();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (peek() as { v: string }).v;
      p++;
      a = { k: 'bin', op, a, b: unaryE() };
    }
    return a;
  };
  const unaryE = (): Expr => {
    if (isOp('!')) {
      p++;
      return { k: 'not', e: unaryE() };
    }
    if (isOp('-')) {
      p++;
      return { k: 'neg', e: unaryE() };
    }
    if (isOp('+')) {
      p++;
      return { k: 'plus', e: unaryE() };
    }
    return powE();
  };
  const powE = (): Expr => {
    const a = postE();
    if (isOp('^')) {
      p++;
      // Right-associative, and binds tighter than unary minus on its left: -2^2 is -4.
      const b = isOp('-') ? (p++, { k: 'neg' as const, e: powE() }) : powE();
      return { k: 'bin', op: '^', a, b };
    }
    return a;
  };
  const postE = (): Expr => {
    if (isOp('++') || isOp('--')) {
      const op = (peek() as { v: string }).v as '++' | '--';
      p++;
      const target = postE();
      if (!lvalue(target)) error();
      return { k: 'incdec', op, prefix: true, target };
    }
    const e = primary();
    if ((isOp('++') || isOp('--')) && lvalue(e)) {
      const op = (peek() as { v: string }).v as '++' | '--';
      p++;
      return { k: 'incdec', op, prefix: false, target: e };
    }
    return e;
  };
  const optLvalue = (): Expr | null => {
    if (peek().t === 'name' || isOp('$')) {
      const e = primary();
      if (lvalue(e)) return e;
      error();
    }
    return null;
  };
  const args = (): Expr[] => {
    expectOp('(');
    const out: Expr[] = [];
    nls();
    if (isOp(')')) {
      p++;
      return out;
    }
    const savedGt = noGt;
    const savedIn = noIn;
    noGt = 0;
    noIn = 0;
    for (;;) {
      out.push(expr());
      nls();
      if (isOp(',')) {
        p++;
        nls();
        continue;
      }
      break;
    }
    noGt = savedGt;
    noIn = savedIn;
    expectOp(')');
    return out;
  };
  const primary = (): Expr => {
    const t = peek();
    switch (t.t) {
      case 'num':
        p++;
        return { k: 'num', v: t.v };
      case 'str':
        p++;
        return { k: 'str', v: t.v };
      case 're':
        p++;
        return { k: 're', re: compileRegex(t.v) };
      case 'func':
        p++;
        return { k: 'call', name: t.v, args: args() };
      case 'builtin': {
        p++;
        if (t.v === 'length' && !isOp('(')) return { k: 'builtin', name: 'length', args: [] };
        return { k: 'builtin', name: t.v, args: args() };
      }
      case 'name': {
        p++;
        if (isOp('[')) {
          p++;
          const subs: Expr[] = [expr()];
          while (isOp(',')) {
            p++;
            nls();
            subs.push(expr());
          }
          expectOp(']');
          return { k: 'index', name: t.v, subs };
        }
        return { k: 'var', name: t.v };
      }
      case 'kw':
        if (t.v === 'getline') {
          p++;
          const target = optLvalue();
          let file: Expr | null = null;
          if (isOp('<')) {
            p++;
            file = postE();
          }
          return { k: 'getline', target, file, cmd: null };
        }
        return error();
      case 'op':
        if (t.v === '$') {
          p++;
          if (isOp('++') || isOp('--')) {
            const op = (peek() as { v: string }).v as '++' | '--';
            p++;
            const target = primary();
            return { k: 'field', e: { k: 'incdec', op, prefix: true, target } };
          }
          if (isOp('-')) {
            p++;
            return { k: 'field', e: { k: 'neg', e: primary() } };
          }
          return { k: 'field', e: primary() };
        }
        if (t.v === '(') {
          p++;
          const savedGt = noGt;
          const savedIn = noIn;
          noGt = 0;
          noIn = 0;
          nls();
          const first = expr();
          nls();
          if (isOp(',')) {
            // (a, b) in arr
            const multi = [first];
            while (isOp(',')) {
              p++;
              nls();
              multi.push(expr());
              nls();
            }
            expectOp(')');
            noGt = savedGt;
            noIn = savedIn;
            if (!isKw('in')) error();
            p++;
            const n = peek();
            if (n.t !== 'name') error();
            p++;
            return { k: 'in', subs: multi, name: (n as { v: string }).v };
          }
          expectOp(')');
          noGt = savedGt;
          noIn = savedIn;
          return { k: 'group', e: first };
        }
        if (t.v === '-' || t.v === '+' || t.v === '!') return unaryE();
        return error();
      default:
        return error();
    }
  };

  const simpleStatement = (): Stmt => {
    const t = peek();
    if (t.t === 'kw') {
      switch (t.v) {
        case 'print':
        case 'printf': {
          p++;
          let list: Expr[] = [];
          noGt++;
          if (isOp('(')) {
            // print (a, b) > "f" — parenthesised list; or print (a) b — an expression that starts with a group.
            const save = p;
            p++;
            noGt--;
            const first: Expr[] = [];
            try {
              nls();
              first.push(expr());
              while (isOp(',')) {
                p++;
                nls();
                first.push(expr());
              }
              nls();
              expectOp(')');
            } finally {
              noGt++;
            }
            if (isOp(';') || isOp('}') || peek().t === 'nl' || peek().t === 'eof' || isOp('>') || isOp('>>') || isOp('|')) list = first;
            else {
              p = save;
              list = exprList();
            }
          } else if (!(isOp(';') || isOp('}') || peek().t === 'nl' || peek().t === 'eof' || isOp('>') || isOp('>>') || isOp('|'))) {
            list = exprList();
          }
          noGt--;
          let redirect: Redirect = null;
          if (isOp('>') || isOp('>>') || isOp('|')) {
            const op = (peek() as { v: string }).v as '>' | '>>' | '|';
            p++;
            redirect = { op, e: concatE() };
          }
          if (t.v === 'printf' && !list.length) error();
          return { k: t.v, args: list, redirect };
        }
        case 'next':
        case 'nextfile':
        case 'break':
        case 'continue':
          p++;
          return { k: t.v };
        case 'exit':
        case 'return': {
          p++;
          const e = isOp(';') || isOp('}') || peek().t === 'nl' || peek().t === 'eof' ? null : expr();
          return { k: t.v, e };
        }
        case 'delete': {
          p++;
          const n = peek();
          if (n.t !== 'name') error();
          p++;
          if (isOp('[')) {
            p++;
            const subs = [expr()];
            while (isOp(',')) {
              p++;
              subs.push(expr());
            }
            expectOp(']');
            return { k: 'delete', name: (n as { v: string }).v, subs };
          }
          return { k: 'delete', name: (n as { v: string }).v, subs: null };
        }
      }
    }
    return { k: 'expr', e: expr() };
  };
  const exprList = (): Expr[] => {
    const out = [expr()];
    while (isOp(',')) {
      p++;
      nls();
      out.push(expr());
    }
    return out;
  };
  const statement = (): Stmt => {
    nls();
    if (isOp('{')) {
      p++;
      const body = block();
      return { k: 'block', body };
    }
    if (isOp(';')) {
      p++;
      return { k: 'block', body: [] };
    }
    const t = peek();
    if (t.t === 'kw') {
      if (t.v === 'if') {
        p++;
        expectOp('(');
        const c = expr();
        expectOp(')');
        nls();
        const then = statement();
        // `else` may follow a newline or semicolon after the then-branch.
        const save = p;
        terminators();
        if (isKw('else')) {
          p++;
          nls();
          return { k: 'if', c, then, else: statement() };
        }
        p = save;
        return { k: 'if', c, then, else: null };
      }
      if (t.v === 'while') {
        p++;
        expectOp('(');
        const c = expr();
        expectOp(')');
        if (isOp(';')) {
          p++;
          return { k: 'while', c, body: { k: 'block', body: [] } };
        }
        nls();
        return { k: 'while', c, body: statement() };
      }
      if (t.v === 'do') {
        p++;
        nls();
        const body = statement();
        terminators();
        if (!isKw('while')) error();
        p++;
        expectOp('(');
        const c = expr();
        expectOp(')');
        endSimple();
        return { k: 'do', c, body };
      }
      if (t.v === 'for') {
        p++;
        expectOp('(');
        if (peek().t === 'name' && peek(1).t === 'kw' && (peek(1) as { v: string }).v === 'in' && peek(2).t === 'name' && toks[p + 3].t === 'op' && (toks[p + 3] as { v: string }).v === ')') {
          const v = (peek() as { v: string }).v;
          const arr = (peek(2) as { v: string }).v;
          p += 4;
          nls();
          return { k: 'forin', v, arr, body: statement() };
        }
        noIn++;
        const init = isOp(';') ? null : simpleStatement();
        noIn--;
        expectOp(';');
        nls();
        const c = isOp(';') ? null : expr();
        expectOp(';');
        nls();
        const step = isOp(')') ? null : simpleStatement();
        expectOp(')');
        if (isOp(';')) {
          p++;
          return { k: 'for', init, c, step, body: { k: 'block', body: [] } };
        }
        nls();
        return { k: 'for', init, c, step, body: statement() };
      }
    }
    const s = simpleStatement();
    endSimple();
    return s;
  };
  const endSimple = () => {
    if (isOp(';') || peek().t === 'nl') {
      p++;
      return;
    }
    if (isOp('}') || peek().t === 'eof') return;
    error();
  };
  const block = (): Stmt[] => {
    const body: Stmt[] = [];
    terminators();
    while (!isOp('}')) {
      if (peek().t === 'eof') error();
      body.push(statement());
      terminators();
    }
    p++;
    return body;
  };

  terminators();
  while (peek().t !== 'eof') {
    if (isKw('function')) {
      p++;
      const n = peek();
      if (n.t !== 'name' && n.t !== 'func') error();
      p++;
      expectOp('(');
      const params: string[] = [];
      while (!isOp(')')) {
        const a = peek();
        if (a.t !== 'name') error();
        params.push((a as { v: string }).v);
        p++;
        if (isOp(',')) {
          p++;
          nls();
        }
      }
      p++;
      nls();
      expectOp('{');
      funcs.set((n as { v: string }).v, { params, body: block() });
    } else if (isKw('BEGIN') || isKw('END')) {
      const kind = isKw('BEGIN') ? 'begin' : 'end';
      p++;
      nls();
      expectOp('{');
      rules.push({ kind, pattern: null, pattern2: null, action: block() });
    } else {
      let pattern: Expr | null = null;
      let pattern2: Expr | null = null;
      if (!isOp('{')) {
        pattern = expr();
        if (isOp(',')) {
          p++;
          nls();
          pattern2 = expr();
        }
      }
      let action: Stmt[] | null = null;
      if (isOp('{')) {
        p++;
        action = block();
      }
      rules.push({ kind: 'main', pattern, pattern2, action });
    }
    terminators();
  }
  return { rules, funcs };
}

// ---- formatting --------------------------------------------------------------------------

/** printf-style formatting as awk does it. */
function format(fmt: string, args: Val[], toStr: (v: Val) => string, toNum: (v: Val) => number): string {
  let out = '';
  let ai = 0;
  const next = (): Val => (ai < args.length ? args[ai++] : UNINIT);
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      continue;
    }
    const m = /^%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?([cdiouxXeEfFgGs%])/.exec(fmt.slice(i));
    if (!m) {
      out += c;
      continue;
    }
    i += m[0].length - 1;
    const conv = m[4];
    if (conv === '%') {
      out += '%';
      continue;
    }
    const flags = m[1];
    let width = m[2] === '*' ? Math.trunc(toNum(next())) : m[2] ? Number(m[2]) : 0;
    let left = flags.includes('-');
    if (width < 0) {
      left = true;
      width = -width;
    }
    const precRaw = m[3] === '*' ? String(Math.trunc(toNum(next()))) : m[3];
    const prec = precRaw === undefined ? undefined : Number(precRaw || 0);
    const v = next();
    let s: string;
    let numeric = true;
    switch (conv) {
      case 'c': {
        numeric = false;
        if (typeof v === 'number') s = String.fromCodePoint(Math.max(0, Math.trunc(v)) % 0x110000);
        else s = toStr(v).slice(0, 1);
        break;
      }
      case 's':
        numeric = false;
        s = toStr(v);
        if (prec !== undefined) s = s.slice(0, prec);
        break;
      case 'd':
      case 'i': {
        const n = Math.trunc(toNum(v));
        s = Number.isFinite(n) ? String(Math.abs(n)) : String(Math.abs(n)).toLowerCase().replace('infinity', 'inf');
        if (prec !== undefined) s = s.padStart(prec, '0');
        if (n < 0) s = '-' + s;
        else if (flags.includes('+')) s = '+' + s;
        else if (flags.includes(' ')) s = ' ' + s;
        break;
      }
      case 'o':
      case 'u':
      case 'x':
      case 'X': {
        let n = Math.trunc(toNum(v));
        if (n < 0) n = n + 2 ** 64;
        s = conv === 'o' ? n.toString(8) : conv === 'u' ? String(n) : n.toString(16);
        if (conv === 'X') s = s.toUpperCase();
        if (prec !== undefined) s = s.padStart(prec, '0');
        if (flags.includes('#') && n !== 0) s = (conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '') + s;
        break;
      }
      default: {
        const n = toNum(v);
        s = formatFloat(n, conv, prec ?? 6, flags.includes('#'));
        if (n >= 0 && !s.startsWith('-')) {
          if (flags.includes('+')) s = '+' + s;
          else if (flags.includes(' ')) s = ' ' + s;
        }
      }
    }
    if (s.length < width) {
      if (left) s = s.padEnd(width);
      else if (numeric && flags.includes('0') && !(prec !== undefined && 'diouxX'.includes(conv)) && /^[-+ ]?[0-9]/.test(s)) {
        const sign = /^[-+ ]/.test(s) ? s[0] : '';
        s = sign + s.slice(sign.length).padStart(width - sign.length, '0');
      } else s = s.padStart(width);
    }
    out += s;
    if (out.length > MAX_STRING) throw new AwkError('string too long');
  }
  return out;
}

function formatFloat(n: number, conv: string, prec: number, alt: boolean): string {
  if (!Number.isFinite(n)) {
    const s = Number.isNaN(n) ? 'nan' : n < 0 ? '-inf' : 'inf';
    return /[EFG]/.test(conv) ? s.toUpperCase() : s;
  }
  const lower = conv.toLowerCase();
  let s: string;
  if (lower === 'f') s = n.toFixed(Math.min(prec, 100));
  else if (lower === 'e') s = expForm(n, prec);
  else {
    const P = prec === 0 ? 1 : prec;
    if (n === 0) s = alt ? (0).toFixed(P - 1) : '0';
    else {
      const x = Math.floor(Math.log10(Math.abs(Number(n.toExponential(P - 1)))));
      if (x < -4 || x >= P) {
        s = expForm(n, P - 1);
        if (!alt) s = s.replace(/\.?0+e/, 'e');
      } else {
        s = n.toFixed(Math.max(0, P - 1 - x));
        if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
      }
    }
  }
  return conv === 'E' || conv === 'G' ? s.toUpperCase() : s;
}

function expForm(n: number, prec: number): string {
  const s = n.toExponential(Math.min(prec, 100));
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}

// ---- interpreter -------------------------------------------------------------------------

class NextSignal {}
class NextFileSignal {}
class ExitSignal {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  readonly v: Val;
  constructor(v: Val) {
    this.v = v;
  }
}

const HELP = `Usage: awk [POSIX or GNU style options] -f progfile [--] file ...
Usage: awk [POSIX or GNU style options] [--] 'program' file ...
POSIX options:\t\tGNU long options: (standard)
\t-f progfile\t\t--file=progfile
\t-F fs\t\t\t--field-separator=fs
\t-v var=val\t\t--assign=var=val
`;

/** Process the escape sequences of a -v assignment or command-line `var=value` operand. */
function cmdlineValue(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/' })[c] ?? '\\' + c);
}

export const awk: Command = (ctx) => {
  const args = ctx.args;
  let fs: string | null = null;
  const assigns: [string, string][] = [];
  const progFiles: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (a === '--help' || a === '-h') {
      ctx.out(HELP);
      return 0;
    }
    if (a === '--version' || a === '-V') {
      ctx.out('GNU Awk 5.2.1, API 3.2\n');
      return 0;
    }
    const long = /^--(field-separator|assign|file)(?:=(.*))?$/s.exec(a);
    const short = /^-([Fvf])(.*)$/s.exec(a);
    if (long || short) {
      const opt = long ? { 'field-separator': 'F', assign: 'v', file: 'f' }[long[1]]! : short![1];
      let v: string | undefined = long ? long[2] : short![2] || undefined;
      if (v === undefined) v = args[++i];
      if (v === undefined) return usage(ctx, `option requires an argument -- ${opt}`, 2);
      if (opt === 'F') fs = v === 't' ? '\t' : cmdlineValue(v);
      else if (opt === 'f') progFiles.push(v);
      else {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(v);
        if (!m) {
          fail(ctx, `fatal: \`${v}' is not a legal variable name`);
          return 2;
        }
        assigns.push([m[1], cmdlineValue(m[2])]);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      if (/^-[bcdeEgiklLMnNoOpPrsStW]/.test(a) || a.startsWith('--')) {
        if (a === '--posix' || a === '--traditional' || a === '-P' || a === '-c' || a === '--re-interval') continue;
        return usage(ctx, `unrecognized option '${a}'`, 2);
      }
    }
    break;
  }
  let source: string;
  if (progFiles.length) {
    const parts: string[] = [];
    for (const f of progFiles) {
      const input = readInput(ctx, f);
      if (!input.ok) {
        fail(ctx, `fatal: can't open source file \`${f}' for reading: ${errorText(input.code)}`);
        return 2;
      }
      parts.push(input.text);
    }
    source = parts.join('\n');
  } else {
    if (i >= args.length) {
      ctx.err(HELP);
      return 2;
    }
    source = args[i++];
  }
  const operands = args.slice(i);

  let prog: Program;
  try {
    prog = parse(source);
  } catch (e) {
    if (e instanceof AwkError) {
      ctx.err(`awk: cmd. line:1: ${e.message}\n`);
      return 2;
    }
    if (e instanceof RangeError) {
      ctx.err('awk: cmd. line:1: program nested too deeply\n');
      return 2;
    }
    throw e;
  }
  return run(ctx, prog, fs, assigns, operands);
};

function run(ctx: CommandContext, prog: Program, fsOpt: string | null, assigns: [string, string][], operands: string[]): number {
  const globals = new Map<string, Val>();
  const arrays = new Map<string, Map<string, Val>>();
  let elements = 0;
  const frames: { scalars: Map<string, Val>; arrays: Map<string, Map<string, Val>> }[] = [];
  const env = ctx.env();
  const environ = new Map<string, Val>(Object.entries(env).map(([k, v]) => [k, strnum(v)]));
  arrays.set('ENVIRON', environ);
  const argv = new Map<string, Val>([['0', 'awk'], ...operands.map((o, k): [string, Val] => [String(k + 1), strnum(o)])]);
  arrays.set('ARGV', argv);
  globals.set('ARGC', operands.length + 1);
  globals.set('FS', fsOpt ?? ' ');
  globals.set('OFS', ' ');
  globals.set('ORS', '\n');
  globals.set('RS', '\n');
  globals.set('NR', 0);
  globals.set('NF', 0);
  globals.set('FNR', 0);
  globals.set('FILENAME', '');
  globals.set('SUBSEP', '\x1c');
  globals.set('RSTART', 0);
  globals.set('RLENGTH', -1);
  globals.set('CONVFMT', '%.6g');
  globals.set('OFMT', '%.6g');
  for (const [k, v] of assigns) globals.set(k, strnum(v));

  let record = '';
  let fields: string[] | null = null; // fields[0] unused; null until split
  let nf = 0;
  let status = 0;
  let randSeed = 0;
  let prevSeed = 0;
  let rng = mulberry(0);
  const outputs = new Map<string, { kind: 'file' | 'pipe'; text: string; append: boolean }>();
  const readers = new Map<string, { lines: string[]; pos: number }>();

  const num = (v: Val): number => (typeof v === 'number' ? v : typeof v === 'string' ? prefixNumber(v) : v.n ?? prefixNumber(v.s));
  const numToStr = (n: number, fmtVar: 'CONVFMT' | 'OFMT'): string => {
    if (Number.isInteger(n) && Math.abs(n) < 1e18) return BigInt(n).toString();
    if (!Number.isFinite(n)) return Number.isNaN(n) ? (Object.is(n, NaN) ? 'nan' : '-nan') : n < 0 ? '-inf' : 'inf';
    return format(str(globals.get(fmtVar) ?? '%.6g'), [n], (x) => str(x), num);
  };
  const str = (v: Val): string => (typeof v === 'string' ? v : typeof v === 'number' ? numToStr(v, 'CONVFMT') : v.s);
  const outStr = (v: Val): string => (typeof v === 'number' ? numToStr(v, 'OFMT') : str(v));
  const bool = (v: Val): boolean => (typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v !== '' : v.n !== null ? v.n !== 0 : v.s !== '');
  const isNumeric = (v: Val) => typeof v === 'number' || (v instanceof StrNum && v.n !== null);
  const compare = (a: Val, b: Val): number => {
    if (isNumeric(a) && isNumeric(b)) {
      const x = num(a);
      const y = num(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = str(a);
    const y = str(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const cap = (s: string): string => {
    if (s.length > MAX_STRING) throw new AwkError('string too long');
    return s;
  };

  // ---- records and fields ----
  const splitRecord = (): void => {
    if (fields) return;
    fields = [''].concat(splitWith(record, str(globals.get('FS')!), true));
    nf = fields.length - 1;
  };
  const setRecord = (s: string): void => {
    record = s;
    fields = null;
    splitRecord();
    globals.set('NF', nf);
  };
  const rebuild = (): void => {
    splitRecord();
    record = fields!.slice(1, nf + 1).join(str(globals.get('OFS')!));
  };
  const getField = (n: number): Val => {
    if (n < 0) throw new AwkError(`attempt to access field ${n}`);
    if (n === 0) return strnum(record);
    splitRecord();
    return n <= nf ? strnum(fields![n]) : UNINIT;
  };
  const setField = (n: number, v: string): void => {
    if (n < 0) throw new AwkError(`attempt to access field ${n}`);
    if (n > 100_000) throw new AwkError('field index too large');
    if (n === 0) {
      setRecord(v);
      return;
    }
    splitRecord();
    while (nf < n) fields![++nf] = '';
    fields![n] = v;
    globals.set('NF', nf);
    rebuild();
  };
  const setNF = (n: number): void => {
    splitRecord();
    n = Math.max(0, Math.trunc(n));
    if (n > 100_000) throw new AwkError('NF too large');
    while (nf < n) fields![++nf] = '';
    nf = n;
    fields!.length = n + 1;
    rebuild();
  };

  /** Split `s` by an awk field separator. */
  function splitWith(s: string, sep: string, isFS: boolean): string[] {
    if (s === '') return [];
    if (sep === ' ') {
      const t = s.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
      return t === '' ? [] : t.split(/[ \t\n]+/);
    }
    if (sep === '') return [...s];
    if (sep.length === 1 && sep !== '\\') {
      if (isFS && sep === '\t') return s.split('\t');
      return s.split(sep);
    }
    return s.split(regexOf(sep));
  }

  const reCache = new Map<string, RegExp>();
  function regexOf(src: string): RegExp {
    let re = reCache.get(src);
    if (!re) {
      re = compileRegex(src);
      if (reCache.size > 500) reCache.clear();
      reCache.set(src, re);
    }
    return re;
  }
  const toRegex = (e: Expr): RegExp => (e.k === 're' ? e.re : regexOf(str(evalE(e))));

  // ---- variables ----
  const frame = () => frames[frames.length - 1];
  const getVar = (name: string): Val => {
    const f = frame();
    if (f && f.scalars.has(name)) return f.scalars.get(name)!;
    if (name === 'NF') {
      splitRecord();
      return nf;
    }
    return globals.get(name) ?? UNINIT;
  };
  const setVar = (name: string, v: Val): void => {
    const f = frame();
    if (f && f.scalars.has(name)) {
      f.scalars.set(name, v);
      return;
    }
    if (arrays.has(name)) throw new AwkError(`attempt to use array \`${name}' in a scalar context`);
    if (name === 'NF') {
      setNF(num(v));
      globals.set('NF', nf);
      return;
    }
    if (name === 'SRAND') return;
    globals.set(name, v);
  };
  const getArray = (name: string): Map<string, Val> => {
    const f = frame();
    if (f && f.arrays.has(name)) return f.arrays.get(name)!;
    if (f && f.scalars.has(name)) {
      // An unused local becomes an array on first use as one.
      if (f.scalars.get(name) === UNINIT) {
        f.scalars.delete(name);
        const a = new Map<string, Val>();
        f.arrays.set(name, a);
        return a;
      }
      throw new AwkError(`attempt to use scalar \`${name}' as an array`);
    }
    let a = arrays.get(name);
    if (!a) {
      if (globals.has(name)) throw new AwkError(`attempt to use scalar \`${name}' as an array`);
      a = new Map();
      arrays.set(name, a);
    }
    return a;
  };
  const subscript = (subs: Expr[]): string => subs.map((s) => str(evalE(s))).join(str(globals.get('SUBSEP')!));
  const store = (arr: Map<string, Val>, key: string, v: Val) => {
    if (!arr.has(key)) {
      if (++elements > MAX_ELEMENTS) throw new AwkError('too many array elements');
    }
    arr.set(key, v);
  };

  const assignTo = (target: Expr, v: Val): void => {
    if (target.k === 'var') setVar(target.name, v);
    else if (target.k === 'field') setField(Math.trunc(num(evalE(target.e))), str(v));
    else if (target.k === 'index') store(getArray(target.name), subscript(target.subs), v);
    else throw new AwkError('assignment to non-lvalue');
  };
  const readLvalue = (target: Expr): Val => {
    if (target.k === 'var') return getVar(target.name);
    if (target.k === 'field') return getField(Math.trunc(num(evalE(target.e))));
    if (target.k === 'index') {
      const arr = getArray(target.name);
      const key = subscript(target.subs);
      if (!arr.has(key)) store(arr, key, UNINIT);
      return arr.get(key)!;
    }
    throw new AwkError('not an lvalue');
  };

  const arith = (op: string, a: number, b: number): number => {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new AwkError('division by zero attempted');
        return a / b;
      case '%':
        if (b === 0) throw new AwkError('division by zero attempted in `%\'');
        return a % b;
      case '^': return Math.pow(a, b);
    }
    return 0;
  };

  // ---- input ----
  interface Source {
    name: string;
    text: string;
    pos: number;
  }
  let current: Source | null = null;
  let argIndex = 1;
  let usedFile = false;
  const nextRecordFrom = (src: Source): string | null => {
    const rs = str(globals.get('RS')!);
    const t = src.text;
    if (src.pos >= t.length) return null;
    if (rs === '\n' || (rs.length === 1 && rs !== ' ')) {
      const end = t.indexOf(rs, src.pos);
      const rec = end < 0 ? t.slice(src.pos) : t.slice(src.pos, end);
      src.pos = end < 0 ? t.length : end + 1;
      return rec;
    }
    if (rs === '') {
      // Paragraph mode: records split by blank lines, newline always a field separator.
      let s = src.pos;
      while (s < t.length && t[s] === '\n') s++;
      if (s >= t.length) {
        src.pos = t.length;
        return null;
      }
      const m = /\n\n+/g;
      m.lastIndex = s;
      const found = m.exec(t);
      const rec = found ? t.slice(s, found.index) : t.slice(s).replace(/\n+$/, '');
      src.pos = found ? found.index + found[0].length : t.length;
      return rec;
    }
    const re = new RegExp(regexOf(rs).source, 'g');
    re.lastIndex = src.pos;
    const found = re.exec(t);
    if (!found || found[0] === '') {
      const rec = t.slice(src.pos);
      src.pos = t.length;
      return rec;
    }
    const rec = t.slice(src.pos, found.index);
    src.pos = found.index + found[0].length;
    return rec;
  };
  /** Next main-input record, moving through the operands; null at the end. */
  const nextMainRecord = (): string | null => {
    for (;;) {
      ctx.tick();
      if (current) {
        const rec = nextRecordFrom(current);
        if (rec !== null) return rec;
        current = null;
      }
      const argc = Math.trunc(num(globals.get('ARGC')!));
      if (argIndex >= argc) {
        if (usedFile) return null;
        usedFile = true;
        current = { name: '', text: ctx.stdin, pos: 0 };
        globals.set('FILENAME', '');
        globals.set('FNR', 0);
        continue;
      }
      const arg = str(argv.get(String(argIndex)) ?? '');
      argIndex++;
      if (arg === '') continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg);
      if (m) {
        setVar(m[1], strnum(cmdlineValue(m[2])));
        continue;
      }
      usedFile = true;
      const input = readInput(ctx, arg);
      if (!input.ok) {
        ctx.err(`awk: cmd. line:1: warning: cannot open file \`${arg}' for reading: ${errorText(input.code)}\n`);
        status = 2;
        continue;
      }
      if (arg !== '-' && ctx.fs.stat(abs(ctx, arg))?.type === 'dir') {
        ctx.err(`awk: warning: command line argument \`${arg}' is a directory: skipped\n`);
        continue;
      }
      current = { name: arg, text: input.text, pos: 0 };
      globals.set('FILENAME', arg);
      globals.set('FNR', 0);
    }
  };

  // ---- output ----
  const write = (text: string, redirect: Redirect): void => {
    if (!redirect) {
      ctx.out(text);
      return;
    }
    const target = str(evalE(redirect.e));
    if (redirect.op === '|') {
      const o = outputs.get(target) ?? { kind: 'pipe' as const, text: '', append: false };
      o.text = cap(o.text + text);
      outputs.set(target, o);
      return;
    }
    if (target === '/dev/stdout' || target === '-') return ctx.out(text);
    if (target === '/dev/stderr') return ctx.err(text);
    let o = outputs.get(target);
    if (!o) {
      o = { kind: 'file', text: '', append: redirect.op === '>>' };
      outputs.set(target, o);
    }
    o.text = cap(o.text + text);
  };
  const closeOutput = (name: string): number => {
    const o = outputs.get(name);
    if (!o) {
      return readers.delete(name) ? 0 : -1;
    }
    outputs.delete(name);
    if (o.kind === 'pipe') return ctx.run(['bash', '-c', name], o.text);
    try {
      const path = abs(ctx, name);
      if (o.append) ctx.fs.appendFile(path, o.text);
      else ctx.fs.writeFile(path, o.text);
      return 0;
    } catch (e) {
      ctx.err(`awk: cmd. line:1: fatal: can't redirect to \`${name}': ${msgOf(e)}\n`);
      return -1;
    }
  };

  // ---- evaluation ----
  const callFunc = (name: string, argExprs: Expr[]): Val => {
    const fn = prog.funcs.get(name);
    if (!fn) throw new AwkError(`function \`${name}' not defined`);
    if (argExprs.length > fn.params.length) throw new AwkError(`function \`${name}' called with more arguments than declared`);
    if (frames.length >= 200) throw new AwkError('function call nesting too deep');
    const scalars = new Map<string, Val>();
    const arrs = new Map<string, Map<string, Val>>();
    fn.params.forEach((param, k) => {
      const a = argExprs[k];
      if (!a) {
        scalars.set(param, UNINIT);
        return;
      }
      // Arrays pass by reference: a bare name that is an array, or an unused one the callee fills as one.
      if (a.k === 'var') {
        const f = frame();
        const local = !!f && (f.scalars.has(a.name) || f.arrays.has(a.name));
        const isArr = local ? f!.arrays.has(a.name) : arrays.has(a.name);
        const untyped = local ? f!.scalars.get(a.name) === UNINIT : !globals.has(a.name) && !arrays.has(a.name);
        if (isArr || (untyped && usesAsArray(fn.body, param))) {
          arrs.set(param, getArray(a.name));
          return;
        }
      }
      scalars.set(param, evalE(a));
    });
    frames.push({ scalars, arrays: arrs });
    try {
      execBlock(fn.body);
      return UNINIT;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.v;
      throw e;
    } finally {
      frames.pop();
    }
  };

  const evalE = (e: Expr): Val => {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 're': {
        e.re.lastIndex = 0;
        return e.re.test(record) ? 1 : 0;
      }
      case 'group': return evalE(e.e);
      case 'var': {
        if (arrays.has(e.name) && !(frame()?.scalars.has(e.name))) throw new AwkError(`attempt to use array \`${e.name}' in a scalar context`);
        return getVar(e.name);
      }
      case 'field': return getField(Math.trunc(num(evalE(e.e))));
      case 'index': {
        const arr = getArray(e.name);
        const key = subscript(e.subs);
        if (!arr.has(key)) store(arr, key, UNINIT);
        return arr.get(key)!;
      }
      case 'assign': {
        if (e.op === '=') {
          const v = evalE(e.e);
          assignTo(e.target, v);
          return v;
        }
        const cur = num(readLvalue(e.target));
        const v = arith(e.op[0], cur, num(evalE(e.e)));
        assignTo(e.target, v);
        return v;
      }
      case 'cond': return bool(evalE(e.c)) ? evalE(e.a) : evalE(e.b);
      case 'and': return bool(evalE(e.a)) && bool(evalE(e.b)) ? 1 : 0;
      case 'or': return bool(evalE(e.a)) || bool(evalE(e.b)) ? 1 : 0;
      case 'in': return getArray(e.name).has(subscript(e.subs)) ? 1 : 0;
      case 'match': {
        const s = str(evalE(e.a));
        const re = toRegex(e.re);
        re.lastIndex = 0;
        return re.test(s) !== e.neg ? 1 : 0;
      }
      case 'bin': return arith(e.op, num(evalE(e.a)), num(evalE(e.b)));
      case 'cmp': {
        const c = compare(evalE(e.a), evalE(e.b));
        switch (e.op) {
          case '<': return c < 0 ? 1 : 0;
          case '<=': return c <= 0 ? 1 : 0;
          case '>': return c > 0 ? 1 : 0;
          case '>=': return c >= 0 ? 1 : 0;
          case '==': return c === 0 ? 1 : 0;
          default: return c !== 0 ? 1 : 0;
        }
      }
      case 'concat': return cap(str(evalE(e.a)) + str(evalE(e.b)));
      case 'not': return bool(evalE(e.e)) ? 0 : 1;
      case 'neg': return -num(evalE(e.e));
      case 'plus': return num(evalE(e.e));
      case 'incdec': {
        const cur = num(readLvalue(e.target));
        const v = e.op === '++' ? cur + 1 : cur - 1;
        assignTo(e.target, v);
        return e.prefix ? v : cur;
      }
      case 'call': return callFunc(e.name, e.args);
      case 'builtin': return builtin(e.name, e.args);
      case 'getline': return getline(e);
    }
  };

  const getline = (e: Extract<Expr, { k: 'getline' }>): Val => {
    if (e.cmd || e.file) {
      const name = str(evalE((e.cmd ?? e.file)!));
      let r = readers.get(name);
      if (!r) {
        let text: string;
        if (e.cmd) {
          for (const [n, o] of outputs) if (o.kind === 'pipe') closeOutput(n);
          text = ctx.capture(['bash', '-c', name], null).stdout;
        } else {
          const input = readInput(ctx, name);
          if (!input.ok) return -1;
          text = input.text;
        }
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        r = { lines, pos: 0 };
        readers.set(name, r);
      }
      if (r.pos >= r.lines.length) return 0;
      const line = r.lines[r.pos++];
      if (e.target) assignTo(e.target, strnum(line));
      else setRecord(line);
      // `cmd | getline` without a variable also counts the record.
      if (e.cmd) globals.set('NR', num(globals.get('NR')!) + 1);
      return 1;
    }
    const rec = nextMainRecord();
    if (rec === null) return 0;
    globals.set('NR', num(globals.get('NR')!) + 1);
    globals.set('FNR', num(globals.get('FNR')!) + 1);
    if (e.target) assignTo(e.target, strnum(rec));
    else setRecord(rec);
    return 1;
  };

  const subOrGsub = (global: boolean, a: Expr[]): Val => {
    if (a.length < 2) throw new AwkError(`${global ? 'gsub' : 'sub'}: requires at least two arguments`);
    const re = toRegex(a[0]);
    const rep = str(evalE(a[1]));
    const target: Expr = a[2] ?? { k: 'field', e: { k: 'num', v: 0 } };
    const s = str(readLvalue(target));
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let out = '';
    let last = 0;
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = g.exec(s)) !== null) {
      ctx.tick();
      n++;
      out += s.slice(last, m.index);
      for (let k = 0; k < rep.length; k++) {
        if (rep[k] === '\\' && (rep[k + 1] === '&' || rep[k + 1] === '\\')) {
          out += rep[++k];
          continue;
        }
        out += rep[k] === '&' ? m[0] : rep[k];
      }
      cap(out);
      last = m.index + m[0].length;
      if (m[0] === '') {
        if (m.index < s.length) out += s[m.index];
        last = m.index + 1;
        g.lastIndex = m.index + 1;
      }
      if (!global || g.lastIndex > s.length) break;
    }
    if (n === 0) return 0;
    out += s.slice(last);
    assignTo(target, out);
    return n;
  };

  const builtin = (name: string, a: Expr[]): Val => {
    const arg = (k: number) => (a[k] ? evalE(a[k]) : UNINIT);
    switch (name) {
      case 'length': {
        if (!a.length) return [...record].length;
        const x = a[0];
        if (x.k === 'var' && (arrays.has(x.name) || frame()?.arrays.has(x.name))) return getArray(x.name).size;
        return [...str(evalE(x))].length;
      }
      case 'substr': {
        const s = [...str(arg(0))];
        let start = Math.round(num(arg(1)));
        let len = a.length > 2 ? Math.round(num(arg(2))) : Infinity;
        if (Number.isNaN(start)) start = 1;
        if (start < 1) {
          len += start - 1;
          start = 1;
        }
        if (!(len > 0)) return '';
        return s.slice(start - 1, start - 1 + Math.min(len, s.length)).join('');
      }
      case 'index': {
        const s = str(arg(0));
        const t = str(arg(1));
        const k = s.indexOf(t);
        return k < 0 ? 0 : [...s.slice(0, k)].length + 1;
      }
      case 'split': {
        const s = str(arg(0));
        const target = a[1];
        if (!target || target.k !== 'var') throw new AwkError('split: second argument is not an array');
        const arr = getArray(target.name);
        elements -= arr.size;
        arr.clear();
        let parts: string[];
        if (a[2]) {
          const sepE = a[2];
          parts = sepE.k === 're' ? (s === '' ? [] : s.split(sepE.re)) : splitWith(s, str(evalE(sepE)), false);
        } else parts = splitWith(s, str(globals.get('FS')!), true);
        parts.forEach((part, k) => store(arr, String(k + 1), strnum(part)));
        return parts.length;
      }
      case 'sub': return subOrGsub(false, a);
      case 'gsub': return subOrGsub(true, a);
      case 'match': {
        const s = str(arg(0));
        const re = toRegex(a[1]);
        re.lastIndex = 0;
        const m = re.exec(s);
        const start = m ? [...s.slice(0, m.index)].length + 1 : 0;
        const len = m ? [...m[0]].length : -1;
        globals.set('RSTART', start);
        globals.set('RLENGTH', len);
        if (a[2] && a[2].k === 'var' && m) {
          const arr = getArray(a[2].name);
          arr.clear();
          m.forEach((g, k) => {
            if (g !== undefined) store(arr, String(k), strnum(g));
          });
        }
        return start;
      }
      case 'sprintf': {
        if (!a.length) throw new AwkError('sprintf: no arguments');
        const vals = a.map(evalE);
        return format(str(vals[0]), vals.slice(1), str, num);
      }
      case 'sin': return Math.sin(num(arg(0)));
      case 'cos': return Math.cos(num(arg(0)));
      case 'atan2': return Math.atan2(num(arg(0)), num(arg(1)));
      case 'exp': return Math.exp(num(arg(0)));
      case 'log': return Math.log(num(arg(0)));
      case 'sqrt': return Math.sqrt(num(arg(0)));
      case 'int': return Math.trunc(num(arg(0)));
      case 'rand': return rng();
      case 'srand': {
        prevSeed = randSeed;
        randSeed = a.length ? Math.trunc(num(arg(0))) : Math.floor(ctx.state.now() / 1000);
        rng = mulberry(randSeed);
        return prevSeed;
      }
      case 'tolower': return str(arg(0)).toLowerCase();
      case 'toupper': return str(arg(0)).toUpperCase();
      case 'system': {
        for (const [n, o] of outputs) if (o.kind === 'pipe') closeOutput(n);
        return ctx.run(['bash', '-c', str(arg(0))], null);
      }
      case 'close': return closeOutput(str(arg(0)));
      case 'fflush': return 0;
    }
    throw new AwkError(`function \`${name}' not defined`);
  };

  // ---- statements ----
  const execBlock = (body: Stmt[]): void => {
    for (const s of body) exec(s);
  };
  const exec = (s: Stmt): void => {
    ctx.tick();
    switch (s.k) {
      case 'expr':
        evalE(s.e);
        return;
      case 'print': {
        const text = s.args.length ? s.args.map((x) => outStr(evalE(x))).join(str(globals.get('OFS')!)) : record;
        write(text + str(globals.get('ORS')!), s.redirect);
        return;
      }
      case 'printf': {
        const vals = s.args.map(evalE);
        write(format(str(vals[0]), vals.slice(1), str, num), s.redirect);
        return;
      }
      case 'if':
        if (bool(evalE(s.c))) exec(s.then);
        else if (s.else) exec(s.else);
        return;
      case 'while':
        while (bool(evalE(s.c))) {
          ctx.tick();
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      case 'do':
        do {
          ctx.tick();
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        } while (bool(evalE(s.c)));
        return;
      case 'for':
        if (s.init) exec(s.init);
        while (!s.c || bool(evalE(s.c))) {
          ctx.tick();
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (!(e instanceof ContinueSignal)) throw e;
          }
          if (s.step) exec(s.step);
        }
        return;
      case 'forin': {
        const keys = [...getArray(s.arr).keys()];
        for (const k of keys) {
          ctx.tick();
          setVar(s.v, strnum(k));
          try {
            exec(s.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'block':
        execBlock(s.body);
        return;
      case 'next':
        throw new NextSignal();
      case 'nextfile':
        throw new NextFileSignal();
      case 'break':
        throw new BreakSignal();
      case 'continue':
        throw new ContinueSignal();
      case 'exit':
        throw new ExitSignal(s.e ? Math.trunc(num(evalE(s.e))) & 255 : status);
      case 'return':
        throw new ReturnSignal(s.e ? evalE(s.e) : UNINIT);
      case 'delete': {
        const arr = getArray(s.name);
        if (s.subs) {
          if (arr.delete(subscript(s.subs))) elements--;
        } else {
          elements -= arr.size;
          arr.clear();
        }
        return;
      }
    }
  };

  const ruleMatches = (r: Rule): boolean => {
    if (!r.pattern) return true;
    if (!r.pattern2) return bool(evalE(r.pattern));
    if (r.inRange) {
      if (bool(evalE(r.pattern2))) r.inRange = false;
      return true;
    }
    if (bool(evalE(r.pattern))) {
      if (!bool(evalE(r.pattern2))) r.inRange = true;
      return true;
    }
    return false;
  };

  const begins = prog.rules.filter((r) => r.kind === 'begin');
  const mains = prog.rules.filter((r) => r.kind === 'main');
  const ends = prog.rules.filter((r) => r.kind === 'end');
  let exitCode: number | null = null;
  const flushAll = () => {
    for (const name of [...outputs.keys()]) closeOutput(name);
  };
  try {
    try {
      for (const r of begins) execBlock(r.action!);
      if (mains.length || ends.length) {
        for (;;) {
          if (ctx.outputFull()) break;
          const rec = nextMainRecord();
          if (rec === null) break;
          globals.set('NR', num(globals.get('NR')!) + 1);
          globals.set('FNR', num(globals.get('FNR')!) + 1);
          setRecord(rec);
          try {
            for (const r of mains) {
              if (!ruleMatches(r)) continue;
              if (r.action) execBlock(r.action);
              else write(record + str(globals.get('ORS')!), null);
            }
          } catch (e) {
            if (e instanceof NextSignal) continue;
            if (e instanceof NextFileSignal) {
              current = null;
              continue;
            }
            throw e;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
      exitCode = e.code;
    }
    // END rules run after exit in BEGIN or main, as in awk; an exit inside END stops them.
    try {
      for (const r of ends) execBlock(r.action!);
    } catch (e) {
      if (!(e instanceof ExitSignal)) throw e;
      exitCode = e.code;
    }
    flushAll();
    return exitCode ?? status;
  } catch (e) {
    if (e instanceof AwkError) {
      flushAll();
      ctx.err(`awk: cmd. line:1: fatal: ${e.message}\n`);
      return 2;
    }
    if (e instanceof BreakSignal || e instanceof ContinueSignal) {
      ctx.err('awk: cmd. line:1: fatal: `break\' or `continue\' outside a loop is not allowed\n');
      return 2;
    }
    if (e instanceof ReturnSignal) {
      ctx.err('awk: cmd. line:1: fatal: `return\' used outside function context\n');
      return 2;
    }
    if (e instanceof NextSignal || e instanceof NextFileSignal) {
      ctx.err('awk: cmd. line:1: fatal: `next\' used in BEGIN or END action\n');
      return 2;
    }
    if (e instanceof RangeError) {
      ctx.err('awk: cmd. line:1: fatal: function calls nested too deeply\n');
      return 2;
    }
    throw e;
  }
}

/** Whether a function body uses `param` as an array, so an unused variable passed for it should become one. */
function usesAsArray(node: unknown, param: string): boolean {
  if (!node || typeof node !== 'object' || node instanceof RegExp) return false;
  if (Array.isArray(node)) return node.some((n) => usesAsArray(n, param));
  const n = node as Record<string, unknown>;
  if ((n.k === 'index' || n.k === 'in' || n.k === 'delete') && n.name === param) return true;
  if (n.k === 'forin' && n.arr === param) return true;
  if (n.k === 'builtin' && n.name === 'split') {
    const target = (n.args as Expr[])[1];
    if (target?.k === 'var' && target.name === param) return true;
  }
  return Object.values(n).some((v) => usesAsArray(v, param));
}

/** A small seeded generator for rand(); awk's default seed is 0, so runs repeat. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
