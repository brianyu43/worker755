// Tokeniser and parser for the supported subset of bash:
//   words with '…', "…" and \ quoting, $NAME / ${NAME} references, ~,
//   pipelines (|), lists (; && ||) and redirects (<, >, >>, N>, N>>, &>, &>>, N>&M).
// Anything else that bash would treat specially (subshells, command substitution,
// background jobs, here-docs) is rejected with a ParseError rather than misread.

/** A run of characters inside a word. `quoted` parts are exempt from tilde, brace and glob expansion. */
export type WordPart = { kind: 'text'; text: string; quoted: boolean } | { kind: 'var'; name: string; quoted: boolean };

export interface Word {
  parts: WordPart[];
}

export type RedirectOp = '<' | '>' | '>>' | '&>' | '&>>' | '>&';

export interface Redirect {
  fd: number; // the fd being redirected (0 for '<', 1 for '>' by default)
  op: RedirectOp;
  target: Word; // for '>&' this may name a file or a digit fd
}

export interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
}

export type Pipeline = SimpleCommand[];

export type ListOp = ';' | '&&' | '||';

export interface ListItem {
  /** How this pipeline is joined to the previous one (null for the first). */
  op: ListOp | null;
  pipeline: Pipeline;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

type Token =
  | { kind: 'word'; word: Word }
  | { kind: 'op'; op: '|' | '&&' | '||' | ';' }
  | { kind: 'redir'; fd: number | null; op: RedirectOp };

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const SPECIAL_VARS = '?#@*$!-0123456789';

function unsupported(what: string): ParseError {
  return new ParseError(`bash: ${what} not supported in this shell`);
}

function unexpected(token: string): ParseError {
  return new ParseError(`bash: syntax error near unexpected token \`${token}'`);
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let parts: WordPart[] | null = null; // current word, null when between words
  let i = 0;

  const addText = (text: string, quoted: boolean): void => {
    if (!parts) parts = [];
    const last = parts[parts.length - 1];
    if (last && last.kind === 'text' && last.quoted === quoted) last.text += text;
    else parts.push({ kind: 'text', text, quoted });
  };
  const startWord = (): void => {
    if (!parts) parts = [];
  };
  const endWord = (): void => {
    if (parts) tokens.push({ kind: 'word', word: { parts } });
    parts = null;
  };

  /** Consume a `$…` reference at line[i] === "$"; a `$` that starts no reference is literal text. */
  const dollar = (quoted: boolean): void => {
    const next = line[i + 1];
    if (next === '(') throw unsupported(line[i + 2] === '(' ? 'arithmetic expansion $((…)) is' : 'command substitution $(…) is');
    if (next === '{') {
      const close = line.indexOf('}', i + 2);
      if (close < 0) throw new ParseError("bash: unexpected EOF while looking for matching `}'");
      const name = line.slice(i + 2, close);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$|^[?#@*$!0-9-]$/.test(name)) throw new ParseError(`bash: \${${name}}: bad substitution`);
      startWord();
      parts!.push({ kind: 'var', name, quoted });
      i = close + 1;
      return;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let j = i + 1;
      while (j < line.length && NAME_CHAR.test(line[j])) j++;
      startWord();
      parts!.push({ kind: 'var', name: line.slice(i + 1, j), quoted });
      i = j;
      return;
    }
    if (next !== undefined && SPECIAL_VARS.includes(next)) {
      startWord();
      parts!.push({ kind: 'var', name: next, quoted });
      i += 2;
      return;
    }
    if (next === "'" && !quoted) throw unsupported("$'…' quoting is");
    addText('$', quoted);
    i++;
  };

  while (i < line.length) {
    const c = line[i];

    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    if (c === '\n') {
      endWord();
      // A newline ends a command; blank lines, and lines after && || or |, add nothing.
      const last = tokens[tokens.length - 1];
      if (last && last.kind !== 'op') tokens.push({ kind: 'op', op: ';' });
      i++;
      continue;
    }
    if (c === '#' && !parts) {
      // Comment to the end of the line; a script goes on after it.
      const nl = line.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }

    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) throw new ParseError("bash: unexpected EOF while looking for matching `''");
      addText(line.slice(i + 1, close), true);
      i = close + 1;
      continue;
    }

    if (c === '"') {
      addText('', true); // so that "" still makes an (empty) word
      i++;
      let closed = false;
      while (i < line.length) {
        const d = line[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\') {
          const e = line[i + 1];
          if (e === '$' || e === '`' || e === '"' || e === '\\') {
            addText(e, true);
            i += 2;
          } else if (e === '\n') {
            i += 2;
          } else {
            addText('\\', true);
            i++;
          }
          continue;
        }
        if (d === '$') {
          dollar(true);
          continue;
        }
        if (d === '`') throw unsupported('command substitution `…` is');
        addText(d, true);
        i++;
      }
      if (!closed) throw new ParseError('bash: unexpected EOF while looking for matching `"\'');
      continue;
    }

    if (c === '\\') {
      if (i + 1 >= line.length) {
        addText('\\', true);
        i++;
      } else if (line[i + 1] === '\n') {
        i += 2;
      } else {
        addText(line[i + 1], true);
        i += 2;
      }
      continue;
    }

    if (c === '$') {
      dollar(false);
      continue;
    }
    if (c === '`') throw unsupported('command substitution `…` is');
    if (c === '(' || c === ')') throw unsupported('subshells and ( … ) grouping are');

    if (c === '|') {
      endWord();
      if (line[i + 1] === '|') {
        tokens.push({ kind: 'op', op: '||' });
        i += 2;
      } else if (line[i + 1] === '&') {
        throw unsupported('|& is');
      } else {
        tokens.push({ kind: 'op', op: '|' });
        i++;
      }
      continue;
    }

    if (c === '&') {
      endWord();
      if (line[i + 1] === '&') {
        tokens.push({ kind: 'op', op: '&&' });
        i += 2;
      } else if (line[i + 1] === '>') {
        const append = line[i + 2] === '>';
        tokens.push({ kind: 'redir', fd: null, op: append ? '&>>' : '&>' });
        i += append ? 3 : 2;
      } else {
        throw unsupported('background jobs (&) are');
      }
      continue;
    }

    if (c === ';') {
      endWord();
      if (line[i + 1] === ';') throw unexpected(';;');
      tokens.push({ kind: 'op', op: ';' });
      i++;
      continue;
    }

    if (c === '<' || c === '>') {
      // A word made only of unquoted digits directly before the operator is an fd number.
      let fd: number | null = null;
      const p = parts as WordPart[] | null;
      if (p && p.length === 1 && p[0].kind === 'text' && !p[0].quoted && /^\d+$/.test(p[0].text)) {
        fd = Number(p[0].text);
        parts = null;
      } else {
        endWord();
      }
      if (c === '<') {
        if (line[i + 1] === '<') throw unsupported(line[i + 2] === '<' ? 'here-strings (<<<) are' : 'here-documents (<<) are');
        if (line[i + 1] === '&' || line[i + 1] === '>') throw unsupported(`the ${line.slice(i, i + 2)} redirection is`);
        tokens.push({ kind: 'redir', fd, op: '<' });
        i++;
      } else if (line[i + 1] === '>') {
        tokens.push({ kind: 'redir', fd, op: '>>' });
        i += 2;
      } else if (line[i + 1] === '&') {
        tokens.push({ kind: 'redir', fd, op: '>&' });
        i += 2;
      } else if (line[i + 1] === '|') {
        tokens.push({ kind: 'redir', fd, op: '>' });
        i += 2;
      } else {
        tokens.push({ kind: 'redir', fd, op: '>' });
        i++;
      }
      continue;
    }

    addText(c, false);
    i++;
  }
  endWord();
  return tokens;
}

function tokenText(t: Token): string {
  if (t.kind === 'op') return t.op;
  if (t.kind === 'redir') return (t.fd ?? '') + t.op;
  return 'word';
}

/** Parse one command line into a list of pipelines. Throws ParseError. */
export function parse(line: string): ListItem[] {
  const tokens = tokenize(line);
  const items: ListItem[] = [];
  let pos = 0;
  let pendingOp: ListOp | null = null;

  const parseCommand = (): SimpleCommand => {
    const cmd: SimpleCommand = { words: [], redirects: [] };
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.kind === 'word') {
        cmd.words.push(t.word);
        pos++;
      } else if (t.kind === 'redir') {
        const target = tokens[pos + 1];
        if (!target) throw unexpected('newline');
        if (target.kind !== 'word') throw unexpected(tokenText(target));
        cmd.redirects.push({ fd: t.fd ?? (t.op === '<' ? 0 : 1), op: t.op, target: target.word });
        pos += 2;
      } else {
        break;
      }
    }
    return cmd;
  };

  while (pos < tokens.length) {
    const t = tokens[pos];
    if (t.kind === 'op') throw unexpected(t.op);
    const pipeline: Pipeline = [];
    for (;;) {
      const cmd = parseCommand();
      if (cmd.words.length === 0 && cmd.redirects.length === 0) {
        const next = tokens[pos];
        if (!next) throw new ParseError('bash: syntax error: unexpected end of file');
        throw unexpected(tokenText(next));
      }
      pipeline.push(cmd);
      const next = tokens[pos];
      if (next && next.kind === 'op' && next.op === '|') {
        pos++;
        if (pos >= tokens.length) throw new ParseError('bash: syntax error: unexpected end of file');
        continue;
      }
      break;
    }
    items.push({ op: pendingOp, pipeline });
    pendingOp = null;
    const sep = tokens[pos];
    if (!sep) break;
    if (sep.kind !== 'op' || sep.op === '|') throw unexpected(tokenText(sep));
    pos++;
    if (sep.op === ';') {
      pendingOp = ';';
    } else {
      if (pos >= tokens.length) throw new ParseError('bash: syntax error: unexpected end of file');
      pendingOp = sep.op;
    }
  }
  return items;
}
