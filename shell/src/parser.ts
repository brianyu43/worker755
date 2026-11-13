// Tokeniser and parser for the bash this shell understands: words with '…', "…", $'…' and \ quoting;
// $NAME and ${…} with bash's operators, $(…) and `…`, $((…)); pipelines, lists, `&`, redirects and
// here-documents; ( … ) and { …; }; if, for, for ((…)), while, until, case, functions, (( … )) and [[ … ]].
// The result is a plain-data tree (no classes), so it can be stored and sent between threads.

/** A run of characters inside a word. `quoted` parts are exempt from splitting, tilde, brace and glob expansion. */
export type WordPart =
  | { kind: 'text'; text: string; quoted: boolean }
  | ParamPart
  | { kind: 'cmd'; source: string; quoted: boolean }
  | { kind: 'arith'; source: string; quoted: boolean };

export interface ParamPart {
  kind: 'param';
  name: string;
  quoted: boolean;
  /** Raw text between [ and ], for arrays. */
  index?: string;
  /** ${#name} */
  length?: boolean;
  /** ${!name}, or ${!prefix*} / ${!arr[@]} with `index` or op '*' / '@'. */
  indirect?: boolean;
  /** One of ':-', '-', ':=', '=', ':?', '?', ':+', '+', '#', '##', '%', '%%', '/', '//', '/#', '/%', '^', '^^', ',', ',,', ':', '@', '*'. */
  op?: string;
  arg?: Word;
  arg2?: Word;
}

export interface Word {
  parts: WordPart[];
  /** `name=( … )`: the words of an array assignment. */
  array?: Word[];
  /** Set on the assignments in front of a command; `parts` is then the value alone. */
  assign?: { name: string; index?: string; append: boolean };
}

export type RedirectOp = '<' | '>' | '>>' | '&>' | '&>>' | '>&' | '<&' | '<<' | '<<-' | '<<<' | '<>' | '>|';

export interface Redirect {
  fd: number; // the fd being redirected (0 for input, 1 for output by default)
  op: RedirectOp;
  target: Word; // for '>&' this may name a file or a digit fd; for here-documents the delimiter
  /** Here-document text, already split into parts when the delimiter was unquoted. */
  heredoc?: Word;
}

export interface SimpleCommand {
  type: 'simple';
  assigns: Word[];
  words: Word[];
  redirects: Redirect[];
}

export interface CondToken {
  word: Word;
  /** Operators and parentheses of [[ … ]]: '&&', '||', '(', ')', '<', '>'. */
  op?: string;
}

export type Command =
  | SimpleCommand
  | { type: 'group'; body: List; redirects: Redirect[] }
  | { type: 'subshell'; body: List; redirects: Redirect[] }
  | { type: 'if'; clauses: { cond: List; body: List }[]; elseBody: List | null; redirects: Redirect[] }
  | { type: 'while'; until: boolean; cond: List; body: List; redirects: Redirect[] }
  | { type: 'for'; name: string; items: Word[] | null; body: List; redirects: Redirect[] }
  | { type: 'cfor'; init: string; cond: string; step: string; body: List; redirects: Redirect[] }
  | { type: 'case'; word: Word; items: CaseItem[]; redirects: Redirect[] }
  | { type: 'arith'; source: string; redirects: Redirect[] }
  | { type: 'cond'; tokens: CondToken[]; redirects: Redirect[] }
  | { type: 'func'; name: string; body: Command; source: string };

export interface CaseItem {
  patterns: Word[];
  body: List;
  end: ';;' | ';&' | ';;&';
}

export interface Pipeline {
  negate: boolean;
  /** `time` in front: report how long it took. */
  timed?: boolean;
  commands: Command[];
  /** For each command but the last: true when `|&` also sends its stderr down the pipe. */
  withStderr?: boolean[];
}

export type ListOp = ';' | '&&' | '||';

export interface ListItem {
  /** How this pipeline is joined to the previous one (null for the first). */
  op: ListOp | null;
  pipeline: Pipeline;
  /** Ended with `&`. */
  background?: boolean;
}

export type List = ListItem[];

export class ParseError extends Error {
  /** The input stopped in the middle of something: more lines would complete it. */
  readonly incomplete: boolean;
  constructor(message: string, incomplete = false) {
    super(message);
    this.name = 'ParseError';
    this.incomplete = incomplete;
  }
}

export interface ParseOptions {
  /** Aliases to expand in command position (interactive shells only). */
  aliases?: Map<string, string>;
}

export interface ParseResult {
  list: List;
  /** Non-fatal complaints, such as a here-document cut short by the end of the input. */
  warnings: string[];
}

type Token =
  | { kind: 'word'; word: Word; start: number; end: number; plain: string | null }
  | { kind: 'op'; op: string; start: number; end: number }
  | { kind: 'redir'; fd: number | null; op: RedirectOp; start: number; end: number }
  | { kind: 'eof'; start: number; end: number };

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const SPECIAL_VARS = '?#@*$!-0123456789';
const META = ' \t\r\n;&|<>()';
/** Deepest nesting of commands, substitutions and parameter expansions in one parse. */
const MAX_DEPTH = 200;

const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', '{', '}', '!', '[[', ']]', 'select', 'time', 'coproc']);

function unexpected(token: string): ParseError {
  return new ParseError(`bash: syntax error near unexpected token \`${token}'`);
}

function eofError(): ParseError {
  return new ParseError('bash: syntax error: unexpected end of file', true);
}

function eofLooking(ch: string): ParseError {
  return new ParseError(`bash: unexpected EOF while looking for matching \`${ch}'`, true);
}

/** Characters of `$'…'` after the escape, and how many input characters it used. */
function ansiEscape(src: string, i: number): [string, number] {
  const e = src[i];
  const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b', '\\': '\\', "'": "'", '"': '"', '?': '?' };
  if (e in simple) return [simple[e], 1];
  if (e === 'x') {
    const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i + 1));
    return m ? [String.fromCharCode(parseInt(m[0], 16)), 1 + m[0].length] : ['\\x', 1];
  }
  if (e === 'u' || e === 'U') {
    const m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(src.slice(i + 1));
    if (m) {
      const cp = parseInt(m[0], 16);
      return [cp <= 0x10ffff ? String.fromCodePoint(cp) : '', 1 + m[0].length];
    }
    return ['\\' + e, 1];
  }
  if (/[0-7]/.test(e ?? '')) {
    const m = /^[0-7]{1,3}/.exec(src.slice(i))!;
    return [String.fromCharCode(parseInt(m[0], 8) & 0xff), m[0].length];
  }
  if (e === 'c' && i + 1 < src.length) return [String.fromCharCode(src.charCodeAt(i + 1) & 0x1f), 2];
  return ['\\' + (e ?? ''), e === undefined ? 0 : 1];
}

class Lexer {
  src: string;
  pos = 0;
  depth: number;
  /** Here-documents whose bodies start after the next newline. */
  private pending: { redirect: Redirect; delim: string; strip: boolean; expand: boolean }[] = [];
  warnings: string[];
  /** Inside [[ … ]]: <, >, (, ) are operators, not redirects or subshells. */
  condMode = false;

  constructor(src: string, depth: number, warnings: string[]) {
    this.src = src;
    this.depth = depth;
    this.warnings = warnings;
  }

  private skipBlanks(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\\' && this.src[this.pos + 1] === '\n') this.pos += 2;
      else if (c === '#') {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++;
      } else break;
    }
  }

  /** True when the next thing in the input is `((`. */
  startsArith(at: number): boolean {
    return this.src[at] === '(' && this.src[at + 1] === '(';
  }

  next(): Token {
    this.skipBlanks();
    const start = this.pos;
    const s = this.src;
    const c = s[this.pos];
    if (c === undefined) {
      if (this.pending.length) this.readHeredocs();
      return { kind: 'eof', start, end: start };
    }
    const op = (o: string): Token => {
      this.pos += o.length;
      return { kind: 'op', op: o, start, end: this.pos };
    };
    if (c === '\n') {
      this.pos++;
      if (this.pending.length) this.readHeredocs();
      return { kind: 'op', op: '\n', start, end: this.pos };
    }
    if (this.condMode) {
      if (s.startsWith('&&', this.pos)) return op('&&');
      if (s.startsWith('||', this.pos)) return op('||');
      if (c === '(' || c === ')' || c === '<' || c === '>') return op(c);
      if (c === ';' || c === '&' || c === '|') throw unexpected(c);
      return this.wordToken(start);
    }
    if (c === '&') {
      if (s.startsWith('&&', this.pos)) return op('&&');
      if (s.startsWith('&>>', this.pos)) return this.redir(start, null, '&>>', 3);
      if (s.startsWith('&>', this.pos)) return this.redir(start, null, '&>', 2);
      return op('&');
    }
    if (c === '|') {
      if (s.startsWith('||', this.pos)) return op('||');
      if (s.startsWith('|&', this.pos)) return op('|&');
      return op('|');
    }
    if (c === ';') {
      if (s.startsWith(';;&', this.pos)) return op(';;&');
      if (s.startsWith(';;', this.pos)) return op(';;');
      if (s.startsWith(';&', this.pos)) return op(';&');
      return op(';');
    }
    if (c === '(' || c === ')') return op(c);
    if (c === '<' || c === '>') return this.redirOp(start, null);
    // A word made only of digits directly before < or > is an fd number.
    const digits = /^\d+(?=[<>])/.exec(s.slice(this.pos, this.pos + 12));
    if (digits) {
      this.pos += digits[0].length;
      return this.redirOp(start, Number(digits[0]));
    }
    return this.wordToken(start);
  }

  private redir(start: number, fd: number | null, op: RedirectOp, len: number): Token {
    this.pos += len;
    return { kind: 'redir', fd, op, start, end: this.pos };
  }

  private redirOp(start: number, fd: number | null): Token {
    const s = this.src;
    const at = (t: string) => s.startsWith(t, this.pos);
    if (at('<<<')) return this.redir(start, fd, '<<<', 3);
    if (at('<<-')) return this.redir(start, fd, '<<-', 3);
    if (at('<<')) return this.redir(start, fd, '<<', 2);
    if (at('<>')) return this.redir(start, fd, '<>', 2);
    if (at('<&')) return this.redir(start, fd, '<&', 2);
    if (at('<(') || at('>(')) throw new ParseError('bash: process substitution <(…) is not supported in this shell');
    if (at('<')) return this.redir(start, fd, '<', 1);
    if (at('>>')) return this.redir(start, fd, '>>', 2);
    if (at('>&')) return this.redir(start, fd, '>&', 2);
    if (at('>|')) return this.redir(start, fd, '>|', 2);
    return this.redir(start, fd, '>', 1);
  }

  private wordToken(start: number): Token {
    const word = this.readWord(false);
    const plain = word.parts.length === 1 && word.parts[0].kind === 'text' && !word.parts[0].quoted ? word.parts[0].text : null;
    return { kind: 'word', word, start, end: this.pos, plain };
  }

  /** The regex after =~ in [[ … ]]: (, ) and | are part of it. */
  readRegexWord(): Token {
    this.skipBlanks();
    const start = this.pos;
    const saved = this.condMode;
    let depth = 0;
    const parts: WordPart[] = [];
    const add = (text: string, quoted: boolean) => {
      const last = parts[parts.length - 1];
      if (last && last.kind === 'text' && last.quoted === quoted) last.text += text;
      else parts.push({ kind: 'text', text, quoted });
    };
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      } else if ((c === ' ' || c === '\t' || c === '\n') && depth === 0) break;
      if (c === '(' || c === ')' || c === '|' || c === '<' || c === '>') {
        add(c, false);
        this.pos++;
        continue;
      }
      const w = this.readWordPiece(false);
      if (!w) break;
      parts.push(...w);
    }
    this.condMode = saved;
    const word = { parts: mergeParts(parts) };
    return { kind: 'word', word, start, end: this.pos, plain: null };
  }

  /** One quoted or unquoted unit of a word, or null at a metacharacter. */
  readWordPiece(noBreak: boolean): WordPart[] | null {
    const s = this.src;
    const c = s[this.pos];
    if (c === undefined) return null;
    if (!noBreak && META.includes(c)) return null;
    if (c === "'") {
      const close = s.indexOf("'", this.pos + 1);
      if (close < 0) throw eofLooking("'");
      const text = s.slice(this.pos + 1, close);
      this.pos = close + 1;
      return [{ kind: 'text', text, quoted: true }];
    }
    if (c === '"') {
      this.pos++;
      const parts = this.readDouble();
      return parts.length ? parts : [{ kind: 'text', text: '', quoted: true }];
    }
    if (c === '\\') {
      if (this.pos + 1 >= s.length) {
        this.pos++;
        return [{ kind: 'text', text: '\\', quoted: true }];
      }
      if (s[this.pos + 1] === '\n') {
        this.pos += 2;
        return [];
      }
      const ch = s[this.pos + 1];
      this.pos += 2;
      return [{ kind: 'text', text: ch, quoted: true }];
    }
    if (c === '$') return this.readDollar(false);
    if (c === '`') return [this.readBacktick(false)];
    this.pos++;
    return [{ kind: 'text', text: c, quoted: false }];
  }

  /** A whole word. With `noBreak`, blanks and operators are part of it (parameter operands). */
  readWord(noBreak: boolean): Word {
    const parts: WordPart[] = [];
    for (;;) {
      // name=( … ) is an array assignment.
      if (this.src[this.pos] === '(' && !noBreak && parts.length && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/.test(plainText(parts) ?? '')) {
        this.pos++;
        return { parts: mergeParts(parts), array: this.readArrayWords() };
      }
      const piece = this.readWordPiece(noBreak);
      if (piece === null) break;
      parts.push(...piece);
    }
    return { parts: mergeParts(parts) };
  }

  private readArrayWords(): Word[] {
    const words: Word[] = [];
    for (;;) {
      while (/[ \t\r\n]/.test(this.src[this.pos] ?? '')) this.pos++;
      const c = this.src[this.pos];
      if (c === undefined) throw eofLooking(')');
      if (c === ')') {
        this.pos++;
        return words;
      }
      if (c === '#') {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++;
        continue;
      }
      const w = this.readWord(false);
      if (!w.parts.length) throw unexpected(c);
      words.push(w);
    }
  }

  /** After an opening ". */
  private readDouble(): WordPart[] {
    const s = this.src;
    const parts: WordPart[] = [];
    let text = '';
    const flush = () => {
      if (text) parts.push({ kind: 'text', text, quoted: true });
      text = '';
    };
    while (this.pos < s.length) {
      const d = s[this.pos];
      if (d === '"') {
        this.pos++;
        flush();
        return parts;
      }
      if (d === '\\') {
        const e = s[this.pos + 1];
        if (e === '$' || e === '`' || e === '"' || e === '\\') {
          text += e;
          this.pos += 2;
        } else if (e === '\n') {
          this.pos += 2;
        } else {
          text += '\\';
          this.pos++;
        }
        continue;
      }
      if (d === '$') {
        flush();
        parts.push(...this.readDollar(true));
        continue;
      }
      if (d === '`') {
        flush();
        parts.push(this.readBacktick(true));
        continue;
      }
      text += d;
      this.pos++;
    }
    throw eofLooking('"');
  }

  private readBacktick(quoted: boolean): WordPart {
    const s = this.src;
    let i = this.pos + 1;
    let source = '';
    while (i < s.length && s[i] !== '`') {
      if (s[i] === '\\' && (s[i + 1] === '$' || s[i + 1] === '`' || s[i + 1] === '\\')) {
        source += s[i + 1];
        i += 2;
        continue;
      }
      source += s[i++];
    }
    if (i >= s.length) throw eofLooking('`');
    this.pos = i + 1;
    return { kind: 'cmd', source, quoted };
  }

  /** At a `$`. */
  private readDollar(quoted: boolean): WordPart[] {
    const s = this.src;
    const next = s[this.pos + 1];
    if (next === '(') {
      const close = matchParen(s, this.pos + 1);
      const inner = s.slice(this.pos + 2, close);
      this.pos = close + 1;
      if (inner.startsWith('(') && inner.endsWith(')') && matchParen(inner, 0) === inner.length - 1) {
        return [{ kind: 'arith', source: inner.slice(1, -1), quoted }];
      }
      return [{ kind: 'cmd', source: inner, quoted }];
    }
    if (next === '[') {
      // Old-style arithmetic: $[ … ]
      const close = s.indexOf(']', this.pos + 2);
      if (close < 0) throw eofLooking(']');
      const source = s.slice(this.pos + 2, close);
      this.pos = close + 1;
      return [{ kind: 'arith', source, quoted }];
    }
    if (next === '{') {
      const close = matchBrace(s, this.pos + 2);
      const inner = s.slice(this.pos + 2, close);
      this.pos = close + 1;
      return [parseParam(inner, quoted, this.depth + 1)];
    }
    if (next !== undefined && NAME_START.test(next)) {
      let j = this.pos + 1;
      while (j < s.length && NAME_CHAR.test(s[j])) j++;
      const name = s.slice(this.pos + 1, j);
      this.pos = j;
      return [{ kind: 'param', name, quoted }];
    }
    if (next !== undefined && SPECIAL_VARS.includes(next)) {
      this.pos += 2;
      return [{ kind: 'param', name: next, quoted }];
    }
    if (next === "'" && !quoted) {
      let i = this.pos + 2;
      let text = '';
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\') {
          const [ch, used] = ansiEscape(s, i + 1);
          text += ch;
          i += 1 + used;
          continue;
        }
        text += s[i++];
      }
      if (i >= s.length) throw eofLooking("'");
      this.pos = i + 1;
      return [{ kind: 'text', text, quoted: true }];
    }
    if (next === '"' && !quoted) {
      this.pos += 2;
      const parts = this.readDouble();
      return parts.length ? parts : [{ kind: 'text', text: '', quoted: true }];
    }
    this.pos++;
    return [{ kind: 'text', text: '$', quoted }];
  }

  /** Text up to the matching `))` of an arithmetic command, at `((`. */
  readArith(): string {
    const close = matchParen(this.src, this.pos);
    const inner = this.src.slice(this.pos + 1, close);
    if (!(inner.startsWith('(') && inner.endsWith(')'))) throw unexpected('(');
    this.pos = close + 1;
    return inner.slice(1, -1);
  }

  registerHeredoc(redirect: Redirect, delimWord: Word): void {
    let delim = '';
    let quotedDelim = false;
    for (const p of delimWord.parts) {
      if (p.kind === 'text') {
        delim += p.text;
        if (p.quoted) quotedDelim = true;
      } else if (p.kind === 'param') delim += '$' + p.name;
      else delim += p.kind === 'cmd' ? `$(${p.source})` : `$((${p.source}))`;
    }
    this.pending.push({ redirect, delim, strip: redirect.op === '<<-', expand: !quotedDelim });
  }

  private readHeredocs(): void {
    const s = this.src;
    for (const h of this.pending) {
      const lines: string[] = [];
      let found = false;
      while (this.pos < s.length) {
        let nl = s.indexOf('\n', this.pos);
        if (nl < 0) nl = s.length;
        let line = s.slice(this.pos, nl);
        this.pos = Math.min(nl + 1, s.length);
        if (h.strip) line = line.replace(/^\t+/, '');
        if (line === h.delim) {
          found = true;
          break;
        }
        lines.push(line);
      }
      if (!found) {
        this.warnings.push(`bash: warning: here-document at line 1 delimited by end-of-file (wanted \`${h.delim}')`);
        heredocCutShort = true;
      }
      const body = lines.map((l) => l + '\n').join('');
      h.redirect.heredoc = h.expand ? heredocWord(body, this.depth + 1) : { parts: [{ kind: 'text', text: body, quoted: true }] };
    }
    this.pending = [];
  }

  hasPendingHeredocs(): boolean {
    return this.pending.length > 0;
  }
}

/** Set while parsing when a here-document ran into the end of the input. */
let heredocCutShort = false;

function plainText(parts: WordPart[]): string | null {
  let s = '';
  for (const p of parts) {
    if (p.kind !== 'text' || p.quoted) return null;
    s += p.text;
  }
  return s;
}

function mergeParts(parts: WordPart[]): WordPart[] {
  const out: WordPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.kind === 'text' && last && last.kind === 'text' && last.quoted === p.quoted && (p.text !== '' || !p.quoted)) {
      last.text += p.text;
      continue;
    }
    if (p.kind === 'text' && p.quoted && p.text === '' && last && last.kind === 'text' && last.quoted) continue;
    out.push(p.kind === 'text' ? { ...p } : p);
  }
  return out;
}

/** Index of the `)` that closes the `(` at `open`, skipping quotes and nested parentheses. */
export function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === "'") {
      const close = s.indexOf("'", i + 1);
      if (close < 0) throw eofLooking("'");
      i = close;
      continue;
    }
    if (c === '"') {
      i = skipDouble(s, i + 1);
      continue;
    }
    if (c === '`') {
      const close = s.indexOf('`', i + 1);
      if (close < 0) throw eofLooking('`');
      i = close;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;(]/.test(s[i - 1]))) {
      // A comment inside $( … ) runs to the end of its line.
      const nl = s.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw eofLooking(')');
}

/** Index of the closing " for a double-quoted string whose body starts at `i`. */
function skipDouble(s: string, i: number): number {
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"') return i;
    if (c === '$' && s[i + 1] === '(') {
      i = matchParen(s, i + 1);
      continue;
    }
    if (c === '$' && s[i + 1] === '{') {
      i = matchBrace(s, i + 2);
      continue;
    }
  }
  throw eofLooking('"');
}

/** Index of the `}` closing a `${` whose body starts at `i`. */
function matchBrace(s: string, i: number): number {
  let depth = 1;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === "'") {
      const close = s.indexOf("'", i + 1);
      if (close < 0) throw eofLooking("'");
      i = close;
      continue;
    }
    if (c === '"') {
      i = skipDouble(s, i + 1);
      continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      i = matchParen(s, i + 1);
      continue;
    }
    if (c === '$' && s[i + 1] === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw eofLooking('}');
}

/** Parse a word from text where blanks and operators are ordinary characters. */
function wordFrom(text: string, depth: number): Word {
  if (depth > MAX_DEPTH) throw new ParseError('bash: expression nested too deeply');
  const lx = new Lexer(text, depth, []);
  return lx.readWord(true);
}

const PARAM_OPS = [':-', ':=', ':?', ':+', '-', '=', '?', '+', '##', '#', '%%', '%', '//', '/#', '/%', '/', '^^', '^', ',,', ',', ':', '@'];

/** The inside of `${ … }`. */
function parseParam(inner: string, quoted: boolean, depth: number): ParamPart {
  if (depth > MAX_DEPTH) throw new ParseError('bash: expression nested too deeply');
  const bad = () => new ParseError(`bash: \${${inner}}: bad substitution`);
  let i = 0;
  const part: ParamPart = { kind: 'param', name: '', quoted };
  if (inner[0] === '#' && inner.length > 1 && !/^#[-=?+:%#/]/.test(inner.slice(0, 2)) ) {
    part.length = true;
    i = 1;
  } else if (inner[0] === '#' && inner.length > 1 && inner[1] === '#') {
    // ${##} is unusual; treat as length of $#.
    part.length = true;
    i = 1;
  } else if (inner[0] === '!' && inner.length > 1) {
    part.indirect = true;
    i = 1;
  }
  const rest = inner.slice(i);
  const m = /^([A-Za-z_][A-Za-z0-9_]*|\d+|[?#@*$!\-0])/.exec(rest);
  if (!m) throw bad();
  part.name = m[1];
  i += m[1].length;
  if (inner[i] === '[') {
    let depthB = 0;
    let j = i;
    for (; j < inner.length; j++) {
      if (inner[j] === '[') depthB++;
      else if (inner[j] === ']' && --depthB === 0) break;
    }
    if (j >= inner.length) throw bad();
    part.index = inner.slice(i + 1, j);
    i = j + 1;
  }
  if (i >= inner.length) return part;
  const tail = inner.slice(i);
  if (part.indirect && (tail === '*' || tail === '@')) {
    part.op = tail;
    return part;
  }
  if (part.length) throw bad();
  const op = PARAM_OPS.find((o) => tail.startsWith(o));
  if (!op) throw bad();
  part.op = op;
  const body = tail.slice(op.length);
  if (op === '/' || op === '//' || op === '/#' || op === '/%') {
    const cut = unquotedIndex(body, '/');
    part.arg = wordFrom(cut < 0 ? body : body.slice(0, cut), depth + 1);
    part.arg2 = wordFrom(cut < 0 ? '' : body.slice(cut + 1), depth + 1);
  } else if (op === ':') {
    const cut = unquotedIndex(body, ':');
    part.arg = wordFrom(cut < 0 ? body : body.slice(0, cut), depth + 1);
    if (cut >= 0) part.arg2 = wordFrom(body.slice(cut + 1), depth + 1);
  } else {
    part.arg = wordFrom(body, depth + 1);
  }
  return part;
}

/** First index of `ch` outside quotes and escapes, or -1. */
function unquotedIndex(s: string, ch: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === "'") {
      const close = s.indexOf("'", i + 1);
      if (close < 0) return -1;
      i = close;
    } else if (c === '"') i = skipDouble(s, i + 1);
    else if (c === '$' && s[i + 1] === '{') i = matchBrace(s, i + 2);
    else if (c === '$' && s[i + 1] === '(') i = matchParen(s, i + 1);
    else if (c === ch) return i;
  }
  return -1;
}

/** An unquoted here-document body: $ expansions and \$ \` \\ escapes, nothing else. */
export function heredocWord(body: string, depth = 0): Word {
  const lx = new Lexer(body, depth, []);
  const parts: WordPart[] = [];
  let text = '';
  const s = body;
  while (lx.pos < s.length) {
    const c = s[lx.pos];
    if (c === '\\' && (s[lx.pos + 1] === '$' || s[lx.pos + 1] === '`' || s[lx.pos + 1] === '\\')) {
      text += s[lx.pos + 1];
      lx.pos += 2;
      continue;
    }
    if (c === '\\' && s[lx.pos + 1] === '\n') {
      lx.pos += 2;
      continue;
    }
    if (c === '$' || c === '`') {
      const before = lx.pos;
      const piece = lx.readWordPiece(true) ?? [];
      if (piece.length === 1 && piece[0].kind === 'text' && lx.pos === before + 1) {
        text += piece[0].text;
        continue;
      }
      if (text) parts.push({ kind: 'text', text, quoted: true });
      text = '';
      for (const p of piece) parts.push({ ...p, quoted: true } as WordPart);
      continue;
    }
    text += c;
    lx.pos++;
  }
  if (text) parts.push({ kind: 'text', text, quoted: true });
  return { parts };
}

const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(\+?)=/;

/** `name=value`, `name[i]=value`, `name+=value`, as typed. */
export function assignmentPrefix(raw: string): RegExpExecArray | null {
  return ASSIGN_RE.exec(raw);
}

/** The assignment word for `raw`, whose lexed form is `word`; null when it is not an assignment. */
function asAssignment(raw: string, word: Word, depth: number): Word | null {
  const m = ASSIGN_RE.exec(raw);
  if (!m) return null;
  const assign = { name: m[1], ...(m[2] !== undefined ? { index: m[2] } : {}), append: m[3] === '+' };
  if (word.array) return { parts: [], array: word.array, assign };
  const rest = raw.slice(m[0].length);
  const lx = new Lexer(rest, depth, []);
  const value = lx.readWord(false);
  return { parts: value.parts.length ? value.parts : [{ kind: 'text', text: '', quoted: true }], assign };
}

class Parser {
  private lx: Lexer;
  private peeked: Token | null = null;
  private aliases?: Map<string, string>;
  /** Aliases expanded at the current command position, so one cannot expand itself forever. */
  private expanding = new Set<string>();
  private depth: number;

  constructor(src: string, opts: ParseOptions, depth: number, warnings: string[]) {
    this.lx = new Lexer(src, depth, warnings);
    this.aliases = opts.aliases;
    this.depth = depth;
  }

  private peek(): Token {
    if (!this.peeked) this.peeked = this.lx.next();
    return this.peeked;
  }

  private next(): Token {
    const t = this.peek();
    this.peeked = null;
    return t;
  }

  private isWord(t: Token, w: string): boolean {
    return t.kind === 'word' && t.plain === w;
  }

  private isOp(t: Token, op: string): boolean {
    return t.kind === 'op' && t.op === op;
  }

  private tokenText(t: Token): string {
    if (t.kind === 'op') return t.op === '\n' ? 'newline' : t.op;
    if (t.kind === 'redir') return (t.fd ?? '') + t.op;
    if (t.kind === 'eof') return 'end of file';
    return this.lx.src.slice(t.start, t.end);
  }

  private fail(t: Token): ParseError {
    if (t.kind === 'eof') return eofError();
    return unexpected(this.tokenText(t));
  }

  private skipNewlines(): void {
    while (this.isOp(this.peek(), '\n')) this.next();
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new ParseError('bash: expression nested too deeply');
  }

  private leave(): void {
    this.depth--;
  }

  program(): List {
    const list = this.list(() => false);
    const t = this.peek();
    if (t.kind !== 'eof') throw this.fail(t);
    return list;
  }

  /** A list of pipelines joined by ; & && || and newlines, up to a token `isEnd` accepts. */
  private list(isEnd: (t: Token) => boolean): List {
    this.enter();
    const items: List = [];
    let pendingOp: ListOp | null = null;
    this.skipNewlines();
    for (;;) {
      this.expanding.clear();
      const t = this.peek();
      if (t.kind === 'eof' || isEnd(t)) {
        if (pendingOp === '&&' || pendingOp === '||') throw this.fail(t);
        break;
      }
      if (t.kind === 'op' && t.op !== '(') throw this.fail(t);
      const pipeline = this.pipeline();
      items.push({ op: pendingOp, pipeline });
      const sep = this.peek();
      if (sep.kind === 'op' && (sep.op === '&&' || sep.op === '||')) {
        this.next();
        this.skipNewlines();
        pendingOp = sep.op as ListOp;
        if (this.peek().kind === 'eof') throw eofError();
        continue;
      }
      if (sep.kind === 'op' && (sep.op === ';' || sep.op === '&')) {
        this.next();
        if (sep.op === '&') items[items.length - 1].background = true;
        pendingOp = ';';
        this.skipNewlines();
        continue;
      }
      if (this.isOp(sep, '\n')) {
        this.skipNewlines();
        pendingOp = ';';
        continue;
      }
      break;
    }
    this.leave();
    return items;
  }

  private pipeline(): Pipeline {
    let negate = false;
    let timed = false;
    for (;;) {
      const t = this.peek();
      if (this.isWord(t, '!')) {
        this.next();
        negate = !negate;
      } else if (this.isWord(t, 'time')) {
        this.next();
        timed = true;
        if (this.isWord(this.peek(), '-p')) this.next();
      } else break;
    }
    const commands = [this.command()];
    const withStderr: boolean[] = [];
    for (;;) {
      const t = this.peek();
      if (!(t.kind === 'op' && (t.op === '|' || t.op === '|&'))) break;
      this.next();
      withStderr.push(t.op === '|&');
      this.skipNewlines();
      const n = this.peek();
      if (n.kind === 'eof') throw eofError();
      commands.push(this.command());
    }
    const p: Pipeline = { negate, commands };
    if (timed) p.timed = true;
    if (withStderr.some(Boolean)) p.withStderr = withStderr;
    return p;
  }

  private redirects(): Redirect[] {
    const out: Redirect[] = [];
    while (this.peek().kind === 'redir') out.push(this.redirect());
    return out;
  }

  private redirect(): Redirect {
    const t = this.next() as Extract<Token, { kind: 'redir' }>;
    const target = this.next();
    if (target.kind === 'eof' || (target.kind === 'op' && target.op === '\n')) throw unexpected('newline');
    if (target.kind !== 'word') throw this.fail(target);
    const input = t.op === '<' || t.op === '<&' || t.op === '<<' || t.op === '<<-' || t.op === '<<<' || t.op === '<>';
    const r: Redirect = { fd: t.fd ?? (input ? 0 : 1), op: t.op, target: target.word };
    if (t.op === '<<' || t.op === '<<-') this.lx.registerHeredoc(r, target.word);
    return r;
  }

  private expect(word: string): void {
    const t = this.next();
    if (!this.isWord(t, word)) throw this.fail(t);
  }

  private command(): Command {
    this.enter();
    try {
      return this.commandInner();
    } finally {
      this.leave();
    }
  }

  private commandInner(): Command {
    const t = this.peek();
    if (t.kind === 'op' && t.op === '(') {
      if (this.lx.startsArith(t.start)) {
        this.peeked = null;
        this.lx.pos = t.start;
        const source = this.lx.readArith();
        return { type: 'arith', source, redirects: this.redirects() };
      }
      this.next();
      const body = this.list((x) => this.isOp(x, ')'));
      const close = this.next();
      if (!this.isOp(close, ')')) throw this.fail(close);
      if (!body.length) throw unexpected(')');
      return { type: 'subshell', body, redirects: this.redirects() };
    }
    if (t.kind === 'word' && t.plain !== null) {
      switch (t.plain) {
        case '{': {
          this.next();
          const body = this.list((x) => this.isWord(x, '}'));
          if (!body.length) throw this.fail(this.peek());
          this.expect('}');
          return { type: 'group', body, redirects: this.redirects() };
        }
        case 'if':
          return this.ifCommand();
        case 'while':
        case 'until': {
          this.next();
          const cond = this.list((x) => this.isWord(x, 'do'));
          this.expect('do');
          const body = this.list((x) => this.isWord(x, 'done'));
          this.expect('done');
          return { type: 'while', until: t.plain === 'until', cond, body, redirects: this.redirects() };
        }
        case 'for':
          return this.forCommand();
        case 'case':
          return this.caseCommand();
        case 'function': {
          this.next();
          const name = this.next();
          if (name.kind !== 'word' || name.plain === null) throw this.fail(name);
          if (this.isOp(this.peek(), '(')) {
            this.next();
            const close = this.next();
            if (!this.isOp(close, ')')) throw this.fail(close);
          }
          return this.funcBody(name.plain, t.start);
        }
        case '[[':
          return this.condCommand();
        case 'select':
        case 'coproc':
          throw new ParseError(`bash: ${t.plain} is not supported in this shell`);
        case 'then': case 'elif': case 'else': case 'fi': case 'do': case 'done': case 'esac': case '}': case 'in': case ']]':
          throw unexpected(t.plain);
      }
    }
    return this.simple();
  }

  private funcBody(name: string, start: number): Command {
    this.skipNewlines();
    const b = this.peek();
    if (!(b.kind === 'op' && b.op === '(') && !(b.kind === 'word' && ['{', 'if', 'while', 'until', 'for', 'case', '[['].includes(b.plain ?? ''))) {
      throw this.fail(b);
    }
    const body = this.command();
    const end = this.peeked ? this.peeked.start : this.lx.pos;
    return { type: 'func', name, body, source: this.lx.src.slice(start, end).trimEnd() };
  }

  private ifCommand(): Command {
    this.next();
    const clauses: { cond: List; body: List }[] = [];
    let elseBody: List | null = null;
    for (;;) {
      const cond = this.list((x) => this.isWord(x, 'then'));
      this.expect('then');
      const body = this.list((x) => this.isWord(x, 'elif') || this.isWord(x, 'else') || this.isWord(x, 'fi'));
      if (!body.length) throw this.fail(this.peek());
      clauses.push({ cond, body });
      const t = this.next();
      if (this.isWord(t, 'elif')) continue;
      if (this.isWord(t, 'else')) {
        elseBody = this.list((x) => this.isWord(x, 'fi'));
        this.expect('fi');
        break;
      }
      if (this.isWord(t, 'fi')) break;
      throw this.fail(t);
    }
    return { type: 'if', clauses, elseBody, redirects: this.redirects() };
  }

  private forCommand(): Command {
    this.next();
    const t = this.peek();
    if (t.kind === 'op' && t.op === '(' && this.lx.startsArith(t.start)) {
      this.peeked = null;
      this.lx.pos = t.start;
      const source = this.lx.readArith();
      const parts = splitArithFor(source);
      if (!parts) throw unexpected('((');
      const sep = this.peek();
      if (this.isOp(sep, ';') || this.isOp(sep, '\n')) this.next();
      this.skipNewlines();
      const body = this.doBody();
      return { type: 'cfor', init: parts[0], cond: parts[1], step: parts[2], body, redirects: this.redirects() };
    }
    const name = this.next();
    if (name.kind !== 'word' || name.plain === null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.plain)) {
      if (name.kind === 'word') throw new ParseError(`bash: \`${this.tokenText(name)}': not a valid identifier`);
      throw this.fail(name);
    }
    this.skipNewlines();
    let items: Word[] | null = null;
    if (this.isWord(this.peek(), 'in')) {
      this.next();
      items = [];
      for (;;) {
        const w = this.peek();
        if (w.kind !== 'word') break;
        this.next();
        items.push(w.word);
      }
      const sep = this.next();
      if (!(this.isOp(sep, ';') || this.isOp(sep, '\n'))) throw this.fail(sep);
    } else if (this.isOp(this.peek(), ';')) {
      this.next();
    }
    this.skipNewlines();
    const body = this.doBody();
    return { type: 'for', name: name.plain, items, body, redirects: this.redirects() };
  }

  private doBody(): List {
    const t = this.peek();
    if (this.isWord(t, '{')) {
      this.next();
      const body = this.list((x) => this.isWord(x, '}'));
      this.expect('}');
      return body;
    }
    this.expect('do');
    const body = this.list((x) => this.isWord(x, 'done'));
    if (!body.length) throw this.fail(this.peek());
    this.expect('done');
    return body;
  }

  private caseCommand(): Command {
    this.next();
    const w = this.next();
    if (w.kind !== 'word') throw this.fail(w);
    this.skipNewlines();
    this.expect('in');
    const items: CaseItem[] = [];
    for (;;) {
      this.skipNewlines();
      let t = this.peek();
      if (this.isWord(t, 'esac')) {
        this.next();
        break;
      }
      if (t.kind === 'eof') throw eofError();
      if (this.isOp(t, '(')) {
        this.next();
        t = this.peek();
      }
      const patterns: Word[] = [];
      for (;;) {
        const p = this.next();
        if (p.kind !== 'word') throw this.fail(p);
        patterns.push(p.word);
        const sep = this.next();
        if (this.isOp(sep, '|')) continue;
        if (this.isOp(sep, ')')) break;
        throw this.fail(sep);
      }
      const isEnd = (x: Token) => this.isWord(x, 'esac') || (x.kind === 'op' && (x.op === ';;' || x.op === ';&' || x.op === ';;&'));
      const body = this.list(isEnd);
      const e = this.peek();
      let end: CaseItem['end'] = ';;';
      if (e.kind === 'op' && (e.op === ';;' || e.op === ';&' || e.op === ';;&')) {
        this.next();
        end = e.op;
      }
      items.push({ patterns, body, end });
    }
    return { type: 'case', word: w.word, items, redirects: this.redirects() };
  }

  private condCommand(): Command {
    this.next();
    const tokens: CondToken[] = [];
    this.peeked = null;
    this.lx.condMode = true;
    try {
      for (;;) {
        const t = this.lx.next();
        if (t.kind === 'eof') throw eofError();
        if (t.kind === 'op' && t.op === '\n') continue;
        if (t.kind === 'word' && t.plain === ']]') break;
        if (t.kind === 'op') tokens.push({ word: { parts: [{ kind: 'text', text: t.op, quoted: false }] }, op: t.op });
        else if (t.kind === 'word') {
          tokens.push({ word: t.word });
          if (t.plain === '=~') {
            const r = this.lx.readRegexWord();
            if (r.kind === 'word') tokens.push({ word: r.word });
          }
        } else throw this.fail(t);
      }
    } finally {
      this.lx.condMode = false;
    }
    if (!tokens.length) throw unexpected(']]');
    return { type: 'cond', tokens, redirects: this.redirects() };
  }

  private simple(): Command {
    const cmd: SimpleCommand = { type: 'simple', assigns: [], words: [], redirects: [] };
    for (;;) {
      const t = this.peek();
      if (t.kind === 'redir') {
        cmd.redirects.push(this.redirect());
        continue;
      }
      if (t.kind !== 'word') break;
      if (cmd.words.length === 0) {
        const a = asAssignment(this.lx.src.slice(t.start, t.end), t.word, this.depth);
        if (a) {
          this.next();
          cmd.assigns.push(a);
          continue;
        }
      }
      if (cmd.words.length === 0 && t.plain !== null && this.aliases?.has(t.plain) && !this.expanding.has(t.plain)) {
        // Splice the alias text in place of the word and read on from there.
        this.expanding.add(t.plain);
        const value = this.aliases.get(t.plain)!;
        this.lx.src = this.lx.src.slice(0, t.start) + value + this.lx.src.slice(t.end);
        this.lx.pos = t.start;
        this.peeked = null;
        const n = this.peek();
        if (!cmd.assigns.length && !cmd.redirects.length && n.kind === 'op' && n.op === '(') return this.commandInner();
        continue;
      }
      if (cmd.words.length === 0 && cmd.assigns.length === 0 && cmd.redirects.length === 0 && t.plain !== null && RESERVED.has(t.plain) && t.plain !== '!' && t.plain !== 'time') {
        return this.commandInner();
      }
      if (cmd.words.length === 0 && cmd.assigns.length === 0 && t.plain !== null && /^[^\s$`'"\\=]+$/.test(t.plain)) {
        // name ( ) compound-command: a function definition.
        this.next();
        if (this.isOp(this.peek(), '(')) {
          this.next();
          const close = this.next();
          if (!this.isOp(close, ')')) throw this.fail(close);
          return this.funcBody(t.plain, t.start);
        }
        cmd.words.push(t.word);
        continue;
      }
      this.next();
      cmd.words.push(t.word);
    }
    if (!cmd.words.length && !cmd.assigns.length && !cmd.redirects.length) throw this.fail(this.peek());
    return cmd;
  }
}

/** `init; cond; step` of for (( … )). */
function splitArithFor(s: string): [string, string, string] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts.length === 3 ? [parts[0], parts[1], parts[2]] : null;
}

/** Parse a command line or script. Throws ParseError. */
export function parseScript(src: string, opts: ParseOptions = {}, depth = 0): ParseResult {
  const warnings: string[] = [];
  heredocCutShort = false;
  const p = new Parser(src, opts, depth, warnings);
  const list = p.program();
  return { list, warnings };
}

/** Parse a command line into its list of pipelines. Throws ParseError. */
export function parse(src: string, opts: ParseOptions = {}): List {
  return parseScript(src, opts).list;
}

/**
 * True when `src` stops partway through a command, a quote, or a here-document, so an interactive
 * shell would ask for another line.
 */
export function isIncomplete(src: string): boolean {
  try {
    parseScript(src);
    // A backslash at the very end continues the line.
    if (/(^|[^\\])(\\\\)*\\$/.test(src)) return true;
    return heredocCutShort;
  } catch (e) {
    return e instanceof ParseError && e.incomplete;
  }
}
