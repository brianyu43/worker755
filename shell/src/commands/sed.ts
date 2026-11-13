// sed: GNU sed's everyday subset. Addresses (N, $, /re/, first~step, a,b, a,+N, 0,/re/, !),
// commands s y d D p P n N g G h H x a i c = l q Q b t T : { } r w z and the -n -e -f -E -r -i -s -z options.

import type { Command } from './context.ts';
import { abs, fail, msgOf, usage } from './context.ts';
import { posixToJs, readInput } from './text.ts';
import { errorText } from '../vfs.ts';

type Addr =
  | { kind: 'line'; n: number }
  | { kind: 'last' }
  | { kind: 're'; re: RegExp | null } // null: the last regex used
  | { kind: 'step'; first: number; step: number }
  | { kind: 'zero' };

interface Cmd {
  a1: Addr | null;
  a2: Addr | { kind: 'plus'; n: number } | { kind: 'mult'; n: number } | null;
  negate: boolean;
  name: string;
  /** s: pattern, replacement, flags; y: from/to; a/i/c: text; b/t/T/:: label; r/w: file. */
  re?: RegExp | null;
  replacement?: string;
  global?: boolean;
  nth?: number;
  print?: number;
  wfile?: string;
  text?: string;
  from?: string;
  to?: string;
  label?: string;
  exitCode?: number;
  /** Index of the matching `}` for `{`. */
  end?: number;
  /** Range state. */
  active?: boolean;
  endLine?: number;
}

class SedError extends Error {}

const HELP = `Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...

  -n, --quiet, --silent
                 suppress automatic printing of pattern space
  -e script, --expression=script
                 add the script to the commands to be executed
  -f script-file, --file=script-file
                 add the contents of script-file to the commands to be executed
  -i[SUFFIX], --in-place[=SUFFIX]
                 edit files in place (makes backup if SUFFIX supplied)
  -E, -r, --regexp-extended
                 use extended regular expressions in the script
  -s, --separate
                 consider files as separate rather than as a single
                 continuous long stream.
  -z, --null-data
                 separate lines by NUL characters
      --help     display this help and exit
`;

/** Turn sed's \n and \t inside a regex into the characters, leaving \\ alone. */
function regexEscapes(src: string): string {
  return src.replace(/\\(.)/gs, (m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : m));
}

function compileRe(src: string, flags: string, extended: boolean): RegExp {
  let js: string;
  try {
    js = posixToJs(regexEscapes(src), extended);
  } catch (e) {
    throw new SedError(`-e expression #1, char 0: ${(e as Error).message}`);
  }
  try {
    return new RegExp(js, flags);
  } catch {
    throw new SedError('-e expression #1, char 0: Invalid preceding regular expression');
  }
}

/** Parses a sed script into a flat list of commands with `{`…`}` linked. */
function parseScript(script: string, extended: boolean): Cmd[] {
  const cmds: Cmd[] = [];
  const stack: number[] = [];
  let i = 0;
  const err = (msg: string): never => {
    throw new SedError(`-e expression #1, char ${i + 1}: ${msg}`);
  };
  const skipWs = () => {
    while (i < script.length && /[ \t]/.test(script[i])) i++;
  };
  /** Text up to an unescaped delimiter; \delim becomes delim, other escapes stay. */
  const delimited = (delim: string, what: string): string => {
    let out = '';
    while (i < script.length && script[i] !== delim) {
      if (script[i] === '\\' && i + 1 < script.length) {
        if (script[i + 1] === delim) out += delim;
        else if (script[i + 1] === '\n') out += '\n';
        else out += script[i] + script[i + 1];
        i += 2;
        continue;
      }
      if (script[i] === '\n' && what !== 'replacement') err(`unterminated \`s' command`);
      out += script[i++];
    }
    if (i >= script.length) err(what === 'y' ? "unterminated `y' command" : "unterminated `s' command");
    i++;
    return out;
  };
  const number = (): number => {
    const m = /^\d+/.exec(script.slice(i));
    if (!m) return err('expected a number');
    i += m[0].length;
    return Number(m[0]);
  };
  const address = (): Addr | null => {
    const c = script[i];
    if (c === '$') {
      i++;
      return { kind: 'last' };
    }
    if (c !== undefined && /\d/.test(c)) {
      const n = number();
      if (script[i] === '~') {
        i++;
        return { kind: 'step', first: n, step: number() };
      }
      return n === 0 ? { kind: 'zero' } : { kind: 'line', n };
    }
    if (c === '/' || c === '\\') {
      let delim = '/';
      if (c === '\\') {
        delim = script[i + 1];
        i++;
      }
      i++;
      const src = delimited(delim, 'address');
      let flags = '';
      while (script[i] === 'I' || script[i] === 'M') flags += script[i++] === 'I' ? 'i' : 'm';
      return { kind: 're', re: src === '' ? null : compileRe(src, flags, extended) };
    }
    return null;
  };
  /** The rest of a line for a, i, c (GNU one-liner form or the classic backslash-newline form). */
  const textArg = (): string => {
    skipWs();
    if (script[i] === '\\') {
      i++;
      if (script[i] === '\n') i++;
    }
    let out = '';
    while (i < script.length && script[i] !== '\n') {
      if (script[i] === '\\' && i + 1 < script.length) {
        out += script[i + 1] === 'n' ? '\n' : script[i + 1] === 't' ? '\t' : script[i + 1];
        i += 2;
        continue;
      }
      out += script[i++];
    }
    return out;
  };
  const label = (): string => {
    skipWs();
    let out = '';
    while (i < script.length && !/[\n;}]/.test(script[i])) out += script[i++];
    return out.trim();
  };
  const fileArg = (): string => {
    skipWs();
    let out = '';
    while (i < script.length && script[i] !== '\n') out += script[i++];
    return out;
  };

  while (i < script.length) {
    while (i < script.length && /[\s;]/.test(script[i])) i++;
    if (i >= script.length) break;
    if (script[i] === '#') {
      while (i < script.length && script[i] !== '\n') i++;
      continue;
    }
    const cmd: Cmd = { a1: null, a2: null, negate: false, name: '' };
    cmd.a1 = address();
    if (cmd.a1 && script[i] === ',') {
      i++;
      if (script[i] === '+' || script[i] === '~') {
        const kind = script[i++] === '+' ? 'plus' : 'mult';
        cmd.a2 = { kind, n: number() };
      } else {
        const a2 = address();
        if (!a2) err('unexpected `,\'');
        cmd.a2 = a2;
      }
    }
    if (cmd.a1?.kind === 'zero' && cmd.a2?.kind !== 're') err('invalid usage of line address 0');
    skipWs();
    while (script[i] === '!') {
      cmd.negate = true;
      i++;
      skipWs();
    }
    const name = script[i++];
    if (name === undefined) err('missing command');
    cmd.name = name;
    switch (name) {
      case '{':
        stack.push(cmds.length);
        break;
      case '}':
        if (cmd.a1) err('} doesn\'t want any addresses');
        if (!stack.length) err('unexpected `}\'');
        cmds[stack.pop()!].end = cmds.length;
        break;
      case 's': {
        const delim = script[i++];
        if (delim === undefined || delim === '\n' || delim === '\\') err("unterminated `s' command");
        const pattern = delimited(delim, 'pattern');
        const replacement = delimited(delim, 'replacement');
        let flags = 'g'; // always 'g' so lastIndex works; `global` decides how many get replaced
        cmd.global = false;
        cmd.print = 0;
        for (;;) {
          const f = script[i];
          if (f === 'g') cmd.global = true;
          else if (f === 'p') cmd.print = (cmd.print ?? 0) + 1;
          else if (f === 'i' || f === 'I') flags += 'i';
          else if (f === 'm' || f === 'M') flags += 'm';
          else if (f === 'e') err('the `e\' flag is not available here');
          else if (f !== undefined && /\d/.test(f)) {
            cmd.nth = number();
            if (cmd.nth === 0) err("number option to `s' command may not be zero");
            continue;
          } else if (f === 'w') {
            i++;
            cmd.wfile = fileArg();
            break;
          } else break;
          i++;
        }
        cmd.re = pattern === '' ? null : compileRe(pattern, flags, extended);
        cmd.replacement = replacement;
        break;
      }
      case 'y': {
        const delim = script[i++];
        const unesc = (s: string) => s.replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
        const from = [...unesc(delimited(delim, 'y'))];
        const to = [...unesc(delimited(delim, 'y'))];
        if (from.length !== to.length) err("strings for `y' command are different lengths");
        cmd.from = from.join('\u0000');
        cmd.to = to.join('\u0000');
        break;
      }
      case 'a':
      case 'i':
      case 'c':
        cmd.text = textArg();
        break;
      case 'b':
      case 't':
      case 'T':
        cmd.label = label();
        break;
      case ':':
        if (cmd.a1) err(': doesn\'t want any addresses');
        cmd.label = label();
        if (!cmd.label) err('":" lacks a label');
        break;
      case 'r':
      case 'R':
      case 'w':
      case 'W':
        cmd.wfile = fileArg();
        break;
      case 'q':
      case 'Q':
      case 'l':
      case 'L': {
        skipWs();
        const m = /^\d+/.exec(script.slice(i));
        if (m) {
          i += m[0].length;
          cmd.exitCode = Number(m[0]);
        }
        break;
      }
      case '=': case 'd': case 'D': case 'p': case 'P': case 'n': case 'N':
      case 'g': case 'G': case 'h': case 'H': case 'x': case 'z': case 'F':
        break;
      case 'e':
        err('the `e\' command is not available here');
        break;
      default:
        i--;
        err(`unknown command: \`${name}'`);
    }
    cmds.push(cmd);
    skipWs();
    if (i < script.length && !/[\n;}#]/.test(script[i]) && !'{aic:btTrRwW'.includes(name)) err(`extra characters after command`);
  }
  if (stack.length) throw new SedError(`-e expression #1, char 0: unmatched \`{'`);
  return cmds;
}

/** sed's replacement text: & and \1..\9, \n, \t, and the GNU case conversions \U \L \u \l \E. */
function substitute(rep: string, m: RegExpExecArray): string {
  let out = '';
  let mode: 'U' | 'L' | null = null;
  let once: 'u' | 'l' | null = null;
  const put = (s: string) => {
    for (const ch of s) {
      let c = mode === 'U' ? ch.toUpperCase() : mode === 'L' ? ch.toLowerCase() : ch;
      if (once) {
        c = once === 'u' ? c.toUpperCase() : c.toLowerCase();
        once = null;
      }
      out += c;
    }
  };
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i];
    if (c === '&') {
      put(m[0]);
      continue;
    }
    if (c === '\\' && i + 1 < rep.length) {
      const e = rep[++i];
      if (/\d/.test(e)) put(m[Number(e)] ?? '');
      else if (e === 'n') put('\n');
      else if (e === 't') put('\t');
      else if (e === 'U' || e === 'L') mode = e;
      else if (e === 'E') mode = null;
      else if (e === 'u' || e === 'l') once = e;
      else put(e);
      continue;
    }
    put(c);
  }
  return out;
}

/** `l`: the pattern space with unprintables escaped, wrapped at 70 columns. */
function listLine(s: string, width = 70): string {
  let body = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === '\\') body += '\\\\';
    else if (ch === '\n') body += '\\n';
    else if (ch === '\t') body += '\\t';
    else if (ch === '\b') body += '\\b';
    else if (ch === '\f') body += '\\f';
    else if (ch === '\r') body += '\\r';
    else if (ch === '\v') body += '\\v';
    else if (ch === '\x07') body += '\\a';
    else if (code < 32 || code === 127) body += '\\' + code.toString(8).padStart(3, '0');
    else body += ch;
  }
  if (width <= 1) return body + '$\n';
  let out = '';
  while (body.length > width - 1) {
    out += body.slice(0, width - 1) + '\\\n';
    body = body.slice(width - 1);
  }
  return out + body + '$\n';
}

export const sed: Command = (ctx) => {
  let quiet = false;
  let extended = false;
  let inPlace: string | null = null;
  let separate = false;
  let nul = false;
  const scripts: string[] = [];
  const files: string[] = [];
  const args = ctx.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      files.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (name === 'help') {
        ctx.out(HELP);
        return 0;
      }
      if (name === 'version') {
        ctx.out('sed (GNU sed) 4.9\n');
        return 0;
      }
      if (name === 'quiet' || name === 'silent') quiet = true;
      else if (name === 'regexp-extended') extended = true;
      else if (name === 'separate') separate = true;
      else if (name === 'null-data') nul = true;
      else if (name === 'posix' || name === 'debug' || name === 'sandbox' || name === 'unbuffered') continue;
      else if (name === 'in-place') {
        inPlace = inline ?? '';
        separate = true;
      } else if (name === 'expression' || name === 'file') {
        const v = inline ?? args[++i];
        if (v === undefined) return usage(ctx, `option '--${name}' requires an argument`);
        if (name === 'expression') scripts.push(v);
        else {
          const input = readInput(ctx, v);
          if (!input.ok) {
            fail(ctx, `couldn't open file ${v}: ${errorText(input.code)}`);
            return 1;
          }
          scripts.push(input.text.replace(/\n$/, ''));
        }
      } else return usage(ctx, `unrecognized option '${a}'`);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (ch === 'n') quiet = true;
        else if (ch === 'E' || ch === 'r') extended = true;
        else if (ch === 's') separate = true;
        else if (ch === 'z') nul = true;
        else if (ch === 'u') continue;
        else if (ch === 'i') {
          inPlace = a.slice(j + 1);
          separate = true;
          break;
        } else if (ch === 'e' || ch === 'f') {
          const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (v === undefined) return usage(ctx, `option requires an argument -- '${ch}'`);
          if (ch === 'e') scripts.push(v);
          else {
            const input = readInput(ctx, v);
            if (!input.ok) {
              fail(ctx, `couldn't open file ${v}: ${errorText(input.code)}`);
              return 1;
            }
            scripts.push(input.text.replace(/\n$/, ''));
          }
          break;
        } else return usage(ctx, `invalid option -- '${ch}'`);
      }
      continue;
    }
    files.push(a);
  }
  if (!scripts.length) {
    if (!files.length) {
      ctx.err(HELP);
      return 1;
    }
    scripts.push(files.shift()!);
  }
  if (inPlace !== null && !files.length) {
    fail(ctx, 'no input files');
    return 1;
  }

  let cmds: Cmd[];
  try {
    cmds = parseScript(scripts.join('\n'), extended);
  } catch (e) {
    if (e instanceof SedError) {
      fail(ctx, e.message);
      return 1;
    }
    throw e;
  }
  const labels = new Map<string, number>();
  cmds.forEach((c, k) => {
    if (c.name === ':') labels.set(c.label!, k);
  });
  for (const c of cmds) {
    if ((c.name === 'b' || c.name === 't' || c.name === 'T') && c.label && !labels.has(c.label)) {
      fail(ctx, `-e expression #1, char 0: can't find label for jump to \`${c.label}'`);
      return 1;
    }
  }

  const sep = nul ? '\0' : '\n';
  // Inputs: either one stream for all files, or one per file (-s / -i).
  interface Unit {
    name: string;
    lines: string[];
    /** Whether the last line ended without a newline. */
    noEol: boolean;
  }
  const units: Unit[] = [];
  let status = 0;
  for (const f of files.length ? files : ['-']) {
    const input = readInput(ctx, f);
    if (!input.ok) {
      fail(ctx, `can't read ${f}: ${errorText(input.code)}`);
      status = 2;
      continue;
    }
    if (inPlace !== null && f !== '-' && ctx.fs.stat(abs(ctx, f))?.type === 'dir') {
      fail(ctx, `couldn't edit ${f}: not a regular file`);
      status = 4;
      continue;
    }
    const text = input.text;
    const lines = text === '' ? [] : text.split(sep);
    const noEol = text !== '' && !text.endsWith(sep);
    if (!noEol && lines.length) lines.pop();
    units.push({ name: f, lines, noEol });
  }
  const streams: Unit[] = separate
    ? units
    : [{ name: '-', lines: units.flatMap((u) => u.lines), noEol: units.length > 0 && units[units.length - 1].noEol }];

  const writes = new Map<string, string>();
  const writeTo = (file: string, text: string) => {
    if (file === '/dev/stdout') ctx.out(text);
    else if (file === '/dev/stderr') ctx.err(text);
    else writes.set(file, (writes.get(file) ?? '') + text);
  };
  for (const c of cmds) if ((c.name === 'w' || c.name === 'W' || c.wfile) && c.name !== 'r' && c.name !== 'R' && c.wfile) writes.set(c.wfile, '');

  let lastRe: RegExp | null = null;
  let quitCode: number | null = null;
  let hold = '';
  let lineNo = 0;
  const rfiles = new Map<string, string[]>();

  try {
    for (const unit of streams) {
      if (quitCode !== null) break;
      let out = '';
      const emit = (s: string) => {
        out += s;
        if (out.length > 4_000_000) throw new SedError('output too large');
      };
      const lines = unit.lines;
      let idx = 0;
      // -s keeps counting lines across files; -i starts each file at 1.
      if (!separate || inPlace !== null) lineNo = 0;
      for (const c of cmds) c.active = false;
      const isLast = () => idx >= lines.length;
      const reTest = (re: RegExp | null, s: string): boolean => {
        const r = re ?? lastRe;
        if (!r) throw new SedError('no previous regular expression');
        lastRe = r;
        r.lastIndex = 0;
        return r.test(s);
      };
      const matchOne = (a: Addr, ps: string): boolean => {
        switch (a.kind) {
          case 'line': return lineNo === a.n;
          case 'last': return isLast();
          case 're': return reTest(a.re, ps);
          case 'step': return a.step <= 0 ? lineNo === a.first : lineNo >= a.first && (lineNo - a.first) % a.step === 0;
          case 'zero': return false;
        }
      };
      const selected = (c: Cmd, ps: string): boolean => {
        if (!c.a1) return true;
        if (!c.a2) return matchOne(c.a1, ps);
        if (c.active) {
          const a2 = c.a2;
          let done: boolean;
          if (a2.kind === 'plus' || a2.kind === 'mult' || a2.kind === 'line') done = lineNo >= c.endLine!;
          else done = matchOne(a2, ps);
          if (done || (a2.kind === 'line' && lineNo >= a2.n)) c.active = false;
          return true;
        }
        const startZero = c.a1.kind === 'zero' && lineNo === 1;
        if (startZero || matchOne(c.a1, ps)) {
          const a2 = c.a2;
          if (a2.kind === 'plus') c.endLine = lineNo + a2.n;
          else if (a2.kind === 'mult') c.endLine = a2.n <= 0 ? lineNo : Math.ceil(lineNo / a2.n) * a2.n;
          else if (a2.kind === 'line') c.endLine = a2.n;
          if (startZero && a2.kind === 're' && reTest(a2.re, ps)) return true;
          if ((a2.kind === 'plus' || a2.kind === 'mult' || a2.kind === 'line') && c.endLine! <= lineNo) return true;
          if (a2.kind === 'last' && isLast()) return true;
          c.active = true;
          return true;
        }
        return false;
      };

      let ps = '';
      let append: string[] = [];
      const flushAppend = () => {
        for (const a of append) emit(a);
        append = [];
      };
      const readNext = (): boolean => {
        if (idx >= lines.length) return false;
        ps = lines[idx++];
        lineNo++;
        return true;
      };
      const endOfCycle = (autoprint: boolean) => {
        if (autoprint && !quiet) emit(ps + (isLast() && unit.noEol ? '' : sep));
        flushAppend();
      };

      let restartWithoutRead = false;
      while (true) {
        if (quitCode !== null) break;
        if (!restartWithoutRead) {
          if (!readNext()) break;
        }
        restartWithoutRead = false;
        let subst = false;
        let pc = 0;
        let deleted = false;
        while (pc < cmds.length) {
          ctx.tick();
          const c = cmds[pc];
          if (c.name === '}' || c.name === ':') {
            pc++;
            continue;
          }
          const sel = selected(c, ps) !== c.negate;
          if (!sel) {
            pc = c.name === '{' ? c.end! + 1 : pc + 1;
            continue;
          }
          let next = pc + 1;
          switch (c.name) {
            case '{':
              break;
            case 's': {
              const re = c.re ?? lastRe;
              if (!re) throw new SedError('no previous regular expression');
              if (c.re) lastRe = c.re;
              re.lastIndex = 0;
              let result = '';
              let last = 0;
              let count = 0;
              let did = false;
              let m: RegExpExecArray | null;
              while ((m = re.exec(ps)) !== null) {
                ctx.tick();
                count++;
                const wanted = c.nth ? count === c.nth || (c.global && count > c.nth) : true;
                if (wanted) {
                  result += ps.slice(last, m.index) + substitute(c.replacement!, m);
                  last = m.index + m[0].length;
                  did = true;
                }
                if (m[0] === '') re.lastIndex++;
                if (wanted && !c.global) break;
                if (re.lastIndex > ps.length) break;
              }
              if (did) {
                ps = result + ps.slice(last);
                subst = true;
                for (let k = 0; k < (c.print ?? 0); k++) emit(ps + sep);
                if (c.wfile) writeTo(c.wfile, ps + '\n');
              }
              break;
            }
            case 'y': {
              const from = c.from!.split('\u0000');
              const to = c.to!.split('\u0000');
              ps = [...ps].map((ch) => {
                const k = from.indexOf(ch);
                return k < 0 ? ch : to[k];
              }).join('');
              break;
            }
            case 'p':
              emit(ps + sep);
              break;
            case 'P':
              emit(ps.split('\n')[0] + sep);
              break;
            case 'd':
              deleted = true;
              next = cmds.length;
              break;
            case 'D':
              if (!ps.includes('\n')) {
                deleted = true;
                next = cmds.length;
              } else {
                ps = ps.slice(ps.indexOf('\n') + 1);
                flushAppend();
                restartWithoutRead = true;
                deleted = true;
                next = cmds.length;
              }
              break;
            case 'n':
              if (quitCode === null && !isLast()) {
                if (!quiet) emit(ps + sep);
                flushAppend();
                readNext();
              } else {
                // GNU: with no next line, n prints and exits without running the rest.
                next = cmds.length;
              }
              break;
            case 'N':
              if (isLast()) {
                next = cmds.length;
              } else {
                flushAppend();
                const keep = ps;
                readNext();
                ps = keep + '\n' + ps;
              }
              break;
            case 'g':
              ps = hold;
              break;
            case 'G':
              ps += '\n' + hold;
              break;
            case 'h':
              hold = ps;
              break;
            case 'H':
              hold += '\n' + ps;
              break;
            case 'x':
              [ps, hold] = [hold, ps];
              break;
            case 'z':
              ps = '';
              break;
            case 'a':
              append.push(c.text! + '\n');
              break;
            case 'i':
              emit(c.text! + '\n');
              break;
            case 'c':
              // With a range, the text replaces the whole range, printed at its end.
              if (!c.a2 || !c.active || c.negate) emit(c.text! + '\n');
              deleted = true;
              next = cmds.length;
              break;
            case '=':
              emit(lineNo + '\n');
              break;
            case 'l':
              emit(listLine(ps, c.exitCode ?? 70));
              break;
            case 'F':
              emit((unit.name === '-' ? '-' : unit.name) + '\n');
              break;
            case 'r': {
              const input = readInput(ctx, c.wfile!);
              if (input.ok && input.text) append.push(input.text.endsWith('\n') ? input.text : input.text + '\n');
              break;
            }
            case 'R': {
              let queue = rfiles.get(c.wfile!);
              if (!queue) {
                const input = readInput(ctx, c.wfile!);
                queue = input.ok ? input.text.split('\n').filter((_l, k, all) => k < all.length - 1 || all[k] !== '') : [];
                rfiles.set(c.wfile!, queue);
              }
              const l = queue.shift();
              if (l !== undefined) append.push(l + '\n');
              break;
            }
            case 'w':
              writeTo(c.wfile!, ps + '\n');
              break;
            case 'W':
              writeTo(c.wfile!, ps.split('\n')[0] + '\n');
              break;
            case 'b':
              next = c.label ? labels.get(c.label)! : cmds.length;
              break;
            case 't':
              if (subst) {
                subst = false;
                next = c.label ? labels.get(c.label)! : cmds.length;
              }
              break;
            case 'T':
              if (!subst) next = c.label ? labels.get(c.label)! : cmds.length;
              else subst = false;
              break;
            case 'q':
              quitCode = c.exitCode ?? 0;
              next = cmds.length;
              break;
            case 'Q':
              quitCode = c.exitCode ?? 0;
              deleted = true;
              append = [];
              next = cmds.length;
              break;
          }
          pc = next;
        }
        if (deleted) {
          if (!restartWithoutRead) flushAppend();
          continue;
        }
        endOfCycle(true);
      }

      if (inPlace !== null && unit.name !== '-') {
        const path = abs(ctx, unit.name);
        try {
          if (inPlace) ctx.fs.writeFile(inPlace.includes('*') ? abs(ctx, inPlace.replaceAll('*', unit.name)) : path + inPlace, ctx.fs.readFile(path));
          ctx.fs.writeFile(path, out);
        } catch (e) {
          fail(ctx, `couldn't edit ${unit.name}: ${msgOf(e)}`);
          status = 4;
        }
      } else ctx.out(out);
    }
  } catch (e) {
    if (!(e instanceof SedError)) throw e;
    fail(ctx, e.message);
    return 4;
  }
  for (const [file, text] of writes) {
    try {
      ctx.fs.writeFile(abs(ctx, file), text);
    } catch (e) {
      fail(ctx, `couldn't open file ${file}: ${msgOf(e)}`);
      status = 4;
    }
  }
  return quitCode ?? status;
};

