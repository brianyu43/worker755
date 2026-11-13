// Conditionals: the `test` / `[` builtin and the `[[ … ]]` command.

import type { CondToken } from './parser.ts';
import { expandChars, expandString, matchPattern, ExpandError } from './expand.ts';
import type { Io, VirtualShell } from './shell.ts';
import { ShellError } from './shell.ts';
import { posixToJs } from './commands/text.ts';
import { resolvePath } from './path.ts';

const UNARY_FILE = new Set(['-e', '-a', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-b', '-c', '-p', '-S', '-g', '-u', '-k', '-O', '-G', '-N']);
const UNARY = new Set([...UNARY_FILE, '-z', '-n', '-t', '-v', '-o', '-R']);
const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef', '=~']);

function fileTest(sh: VirtualShell, op: string, arg: string, io: Io): boolean {
  if (op === '-t') {
    const fd = Number(arg);
    if (fd === 0) return io.stdin === null;
    const out = io.out.get(fd);
    return out?.kind === 'tty';
  }
  if (arg === '') return false;
  const path = resolvePath(sh.state.cwd, arg);
  if (path === '/dev/null' || path === '/dev/zero' || path === '/dev/random' || path === '/dev/urandom' || path === '/dev/tty') {
    return op === '-e' || op === '-a' || op === '-c' || op === '-r' || op === '-w';
  }
  const st = sh.fs.stat(path);
  if (!st) return false;
  switch (op) {
    case '-e': case '-a': return true;
    case '-f': return st.type === 'file';
    case '-d': return st.type === 'dir';
    case '-r': return (st.mode & 0o444) !== 0;
    case '-w': return (st.mode & 0o222) !== 0 && !sh.fs.isSystem(path);
    case '-x': return (st.mode & 0o111) !== 0;
    case '-s': return st.type === 'dir' || st.size > 0;
    case '-O': case '-G': return true;
    case '-g': return (st.mode & 0o2000) !== 0;
    case '-u': return (st.mode & 0o4000) !== 0;
    case '-k': return (st.mode & 0o1000) !== 0;
    case '-N': return false;
    default: return false; // -L -h -b -c -p -S: no links, devices, pipes or sockets here
  }
}

function integer(v: string, cmd: string): bigint {
  const t = v.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new ShellError(`bash: ${cmd}: ${v}: integer expression expected`, 2);
  return BigInt(t);
}

function compareInts(op: string, a: bigint, b: bigint): boolean {
  switch (op) {
    case '-eq': return a === b;
    case '-ne': return a !== b;
    case '-lt': return a < b;
    case '-le': return a <= b;
    case '-gt': return a > b;
    default: return a >= b;
  }
}

function unaryTest(sh: VirtualShell, op: string, arg: string, io: Io): boolean {
  if (op === '-z') return arg === '';
  if (op === '-n') return arg !== '';
  if (op === '-v') {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(arg);
    if (!m) return false;
    return m[2] !== undefined ? sh.element(m[1], m[2], io) !== null : sh.vars.has(m[1]) || sh.param(m[1]) !== null;
  }
  if (op === '-R') return false;
  if (op === '-o') return sh.options[arg] === true;
  return fileTest(sh, op, arg, io);
}

function binaryFileTest(sh: VirtualShell, op: string, a: string, b: string): boolean {
  const sa = sh.fs.stat(resolvePath(sh.state.cwd, a));
  const sb = sh.fs.stat(resolvePath(sh.state.cwd, b));
  if (op === '-ef') return !!sa && !!sb && sa.path === sb.path;
  if (op === '-nt') return !!sa && (!sb || sa.mtime > sb.mtime);
  return !!sb && (!sa || sa.mtime < sb.mtime);
}

// ---- test / [ ----------------------------------------------------------------------------

/** The `test` and `[` builtins over already-expanded arguments. Returns 0, 1, or 2 on a usage error. */
export function testCommand(sh: VirtualShell, name: string, argsIn: string[], io: Io): number {
  let args = argsIn;
  if (name === '[') {
    if (args[args.length - 1] !== ']') {
      sh.err(io, "bash: [: missing `]'\n");
      return 2;
    }
    args = args.slice(0, -1);
  }
  const cmd = name;
  let pos = 0;
  const peek = () => args[pos];
  const fail = (msg: string) => new ShellError(`bash: ${cmd}: ${msg}`, 2);

  const primary = (): boolean => {
    const a = args[pos];
    if (a === undefined) throw fail('argument expected');
    if (a === '!' ) {
      pos++;
      return !primary();
    }
    if (a === '(' && args.length - pos >= 3) {
      pos++;
      const v = orExpr();
      if (args[pos] !== ')') throw fail("`)' expected");
      pos++;
      return v;
    }
    // A binary operator with something on both sides wins over a unary reading.
    if (pos + 2 < args.length + 0 && BINARY.has(args[pos + 1]) && args[pos + 1] !== '=~') {
      const op = args[pos + 1];
      const b = args[pos + 2];
      pos += 3;
      return binary(a, op, b);
    }
    if (UNARY.has(a) && pos + 1 < args.length) {
      pos += 2;
      return unaryTest(sh, a, args[pos - 1], io);
    }
    pos++;
    return a !== '';
  };
  const binary = (a: string, op: string, b: string): boolean => {
    switch (op) {
      case '=': case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '-nt': case '-ot': case '-ef': return binaryFileTest(sh, op, a, b);
      default: return compareInts(op, integer(a, cmd), integer(b, cmd));
    }
  };
  const andExpr = (): boolean => {
    let v = primary();
    while (peek() === '-a') {
      pos++;
      const r = primary();
      v = v && r;
    }
    return v;
  };
  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek() === '-o') {
      pos++;
      const r = andExpr();
      v = v || r;
    }
    return v;
  };

  try {
    if (args.length === 0) return 1;
    // POSIX rules by argument count first: they decide the ambiguous cases.
    if (args.length === 1) return args[0] !== '' ? 0 : 1;
    if (args.length === 2) {
      if (args[0] === '!') return args[1] === '' ? 0 : 1;
      if (UNARY.has(args[0])) return unaryTest(sh, args[0], args[1], io) ? 0 : 1;
      throw fail(`${args[0]}: unary operator expected`);
    }
    if (args.length === 3 && BINARY.has(args[1]) && args[1] !== '=~') return binary(args[0], args[1], args[2]) ? 0 : 1;
    const v = orExpr();
    if (pos < args.length) throw fail('too many arguments');
    return v ? 0 : 1;
  } catch (e) {
    if (e instanceof ShellError) {
      sh.err(io, e.message + '\n');
      return 2;
    }
    throw e;
  }
}

// ---- [[ … ]] -----------------------------------------------------------------------------

/** Evaluates `[[ … ]]`. Returns 0 or 1; throws ShellError (status 2) for syntax errors. */
export function evalCond(sh: VirtualShell, tokens: CondToken[], io: Io): number {
  const host = sh.host(io);
  let pos = 0;
  const isOp = (op: string) => tokens[pos]?.op === op;
  const text = (i: number) => {
    const t = tokens[i];
    if (!t || t.op) return null;
    const p = t.word.parts;
    return p.length === 1 && p[0].kind === 'text' && !p[0].quoted ? p[0].text : null;
  };
  const str = (i: number) => expandString(tokens[i].word, host);
  const syntax = (near: string) => new ShellError(`bash: syntax error in conditional expression${near ? `: unexpected token \`${near}'` : ''}`, 2);

  const primary = (): boolean => {
    if (pos >= tokens.length) throw syntax('');
    if (text(pos) === '!') {
      pos++;
      return !primary();
    }
    if (isOp('(')) {
      pos++;
      const v = orExpr();
      if (!isOp(')')) throw syntax(tokens[pos] ? 'x' : '');
      pos++;
      return v;
    }
    const first = text(pos);
    // Binary operators.
    const opTok = tokens[pos + 1];
    const opText = opTok ? (opTok.op === '<' || opTok.op === '>' ? opTok.op : text(pos + 1)) : null;
    if (opText && (BINARY.has(opText)) && pos + 2 < tokens.length) {
      const left = str(pos);
      const rightTok = tokens[pos + 2];
      pos += 3;
      switch (opText) {
        case '=': case '==': case '!=': {
          const m = matchPattern(expandChars(rightTok.word, host), left);
          return opText === '!=' ? !m : m;
        }
        case '=~': {
          const chars = expandChars(rightTok.word, host, false);
          let src = '';
          for (const ch of chars) src += ch.q && /[.*+?^${}()|[\]\\/]/.test(ch.c) ? '\\' + ch.c : ch.c;
          let re: RegExp;
          try {
            re = new RegExp(posixToJs(src, true));
          } catch {
            return false;
          }
          const m = re.exec(left);
          sh.vars.set('BASH_REMATCH', { indexed: new Map((m ?? []).map((s, i) => [i, s ?? ''])) });
          return m !== null;
        }
        case '<': return left < str(pos - 1);
        case '>': return left > str(pos - 1);
        case '-nt': case '-ot': case '-ef': return binaryFileTest(sh, opText, left, str(pos - 1));
        default: {
          const a = sh.arith(left || '0', io);
          const b = sh.arith(str(pos - 1) || '0', io);
          return compareInts(opText, a, b);
        }
      }
    }
    if (first !== null && UNARY.has(first) && pos + 1 < tokens.length && !tokens[pos + 1].op) {
      pos += 2;
      return unaryTest(sh, first, str(pos - 1), io);
    }
    const v = str(pos);
    pos++;
    return v !== '';
  };
  const andExpr = (): boolean => {
    let v = primary();
    while (isOp('&&')) {
      pos++;
      if (!v) {
        // Still parse the right side, without evaluating it.
        skip();
        continue;
      }
      v = primary();
    }
    return v;
  };
  const orExpr = (): boolean => {
    let v = andExpr();
    while (isOp('||')) {
      pos++;
      if (v) {
        skipAnd();
        continue;
      }
      v = andExpr();
    }
    return v;
  };
  // Skipping: advance past one operand without expanding it.
  const skip = () => {
    if (text(pos) === '!') {
      pos++;
      skip();
      return;
    }
    if (isOp('(')) {
      let depth = 0;
      do {
        if (isOp('(')) depth++;
        if (isOp(')')) depth--;
        pos++;
      } while (depth > 0 && pos < tokens.length);
      return;
    }
    const op = tokens[pos + 1];
    const opText = op ? (op.op === '<' || op.op === '>' ? op.op : text(pos + 1)) : null;
    if (opText && BINARY.has(opText) && pos + 2 < tokens.length) pos += 3;
    else if (text(pos) !== null && UNARY.has(text(pos)!) && pos + 1 < tokens.length) pos += 2;
    else pos++;
  };
  const skipAnd = () => {
    skip();
    while (isOp('&&')) {
      pos++;
      skip();
    }
  };

  try {
    const v = orExpr();
    if (pos < tokens.length) throw syntax(text(pos) ?? tokens[pos].op ?? '');
    return v ? 0 : 1;
  } catch (e) {
    if (e instanceof ExpandError) throw e;
    if (e instanceof ShellError) throw e;
    throw e;
  }
}
