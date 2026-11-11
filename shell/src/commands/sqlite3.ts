// sqlite3: the SQLite command-line shell, non-interactive. The database file holds .dump text.

import type { Command } from './context.ts';
import { abs } from './context.ts';
import { dirname } from '../path.ts';
import { Database } from '../sql/engine.ts';
import { SqlError } from '../sql/errors.ts';
import type { SqlResult, SqlValue } from '../sql/errors.ts';
import { isComplete } from '../sql/tokenizer.ts';
import { like, numToText, sqlLiteral } from '../sql/values.ts';

export const SQLITE_VERSION_LINE = '3.46.1 2024-08-13 09:16:08 c9c2ab54ba1f5f46360f1b4f35d849cd3f080e6fc2b6c60e91b16c63f69aalt1 (64-bit)';

const MODES = ['list', 'csv', 'column', 'json', 'line', 'box', 'table', 'markdown', 'tabs', 'quote'] as const;
type Mode = (typeof MODES)[number];

interface Settings {
  mode: Mode;
  header: boolean;
  headerSet: boolean;
  colSep: string;
  rowSep: string;
  nullValue: string;
}

const HELP = `Usage: sqlite3 [OPTIONS] [FILENAME [SQL...]]
FILENAME is the name of an SQLite database. A new database is created
if the file does not previously exist. Defaults to :memory:.
OPTIONS include:
   -bail                stop after hitting an error
   -batch               force batch I/O
   -box                 set output mode to 'box'
   -column              set output mode to 'column'
   -csv                 set output mode to 'csv'
   -header              turn headers on
   -help                show this message
   -json                set output mode to 'json'
   -line                set output mode to 'line'
   -list                set output mode to 'list'
   -markdown            set output mode to 'markdown'
   -newline SEP         set output row separator. Default: '\\n'
   -noheader            turn headers off
   -nullvalue TEXT      set text string for NULL values. Default ''
   -quote               set output mode to 'quote'
   -readonly            open the database read-only
   -separator SEP       set output column separator. Default: '|'
   -table               set output mode to 'table'
   -tabs                set output mode to 'tabs'
   -version             show SQLite version
`;

const DOT_HELP = `.databases               List names and files of attached databases
.dump ?OBJECTS?          Render database content as SQL
.exit ?CODE?             Exit this program with return-code CODE
.headers on|off          Turn display of headers on or off
.help ?-all? ?PATTERN?   Show help text for PATTERN
.indexes ?TABLE?         Show names of indexes
.mode MODE ?OPTIONS?     Set output mode
.nullvalue STRING        Use STRING in place of NULL values
.print STRING...         Print literal STRING
.quit                    Stop interpreting input stream, exit if primary.
.read FILE               Read input from FILE or command output
.schema ?PATTERN?        Show the CREATE statements matching PATTERN
.separator COL ?ROW?     Change the column and row separators
.show                    Show the current values for various settings
.tables ?TABLE?          List names of tables matching LIKE pattern TABLE
`;

/** C-style escapes in separators: \t, \n, \\, … */
function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_m, c: string) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\', '"': '"', "'": "'" })[c] ?? c);
}

function cell(v: SqlValue, s: Settings): string {
  if (v === null) return s.nullValue;
  return typeof v === 'number' ? numToText(v) : v;
}

function csvField(v: string | null, s: Settings): string {
  if (v === null) return s.nullValue;
  if (v === '' || /[\x00-\x20"'\x7f-￿]/.test(v) || v.includes(s.colSep)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

const width = (s: string) => Array.from(s).length;
const padRight = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));

/** Render one statement's result in the current output mode. */
function render(r: SqlResult, s: Settings): string {
  if (r.rows.length === 0) return '';
  const cols = r.columns;
  let out = '';
  switch (s.mode) {
    case 'list':
    case 'tabs': {
      const sep = s.mode === 'tabs' ? '\t' : s.colSep;
      if (s.header) out += cols.join(sep) + s.rowSep;
      for (const row of r.rows) out += row.map((v) => cell(v, s)).join(sep) + s.rowSep;
      return out;
    }
    case 'csv': {
      if (s.header) out += cols.map((c) => csvField(c, s)).join(s.colSep) + s.rowSep;
      for (const row of r.rows) out += row.map((v) => csvField(v === null ? null : cell(v, s), s)).join(s.colSep) + s.rowSep;
      return out;
    }
    case 'quote': {
      if (s.header) out += cols.map((c) => sqlLiteral(c)).join(',') + s.rowSep;
      for (const row of r.rows) out += row.map((v) => (typeof v === 'number' ? numToText(v) : sqlLiteral(v))).join(',') + s.rowSep;
      return out;
    }
    case 'line': {
      const w = Math.max(5, ...cols.map(width));
      r.rows.forEach((row, i) => {
        if (i > 0) out += s.rowSep;
        row.forEach((v, j) => (out += `${' '.repeat(Math.max(0, w - width(cols[j])))}${cols[j]} = ${cell(v, s)}${s.rowSep}`));
      });
      return out;
    }
    case 'json': {
      const lines = r.rows.map((row) => '{' + row.map((v, j) => {
        const val = v === null ? 'null' : typeof v === 'number' ? (Number.isFinite(v) ? numToText(v) : 'null') : JSON.stringify(v);
        return JSON.stringify(cols[j]) + ':' + val;
      }).join(',') + '}');
      return '[' + lines.join(',\n') + ']\n';
    }
    default: {
      const header = s.mode !== 'column' || s.header;
      const data = r.rows.map((row) => row.map((v) => cell(v, s)));
      const ws = cols.map((c, j) => Math.max(header ? width(c) : 0, ...data.map((row) => width(row[j]))));
      const line = (l: string, fill: string, mid: string, rgt: string) => l + ws.map((w) => fill.repeat(w + 2)).join(mid) + rgt + '\n';
      if (s.mode === 'column') {
        if (header) {
          out += cols.map((c, j) => padRight(c, ws[j])).join('  ') + '\n';
          out += ws.map((w) => '-'.repeat(w)).join('  ') + '\n';
        }
        for (const row of data) out += row.map((v, j) => padRight(v, ws[j])).join('  ') + '\n';
        return out;
      }
      const box = s.mode === 'box';
      const v = box ? '│' : '|';
      const row = (cells: string[]) => `${v} ` + cells.map((c, j) => padRight(c, ws[j])).join(` ${v} `) + ` ${v}\n`;
      if (s.mode === 'table') out += line('+', '-', '+', '+');
      if (box) out += line('┌', '─', '┬', '┐');
      out += row(cols);
      if (s.mode === 'table') out += line('+', '-', '+', '+');
      if (box) out += line('├', '─', '┼', '┤');
      if (s.mode === 'markdown') out += line('|', '-', '|', '|');
      for (const d of data) out += row(d);
      if (s.mode === 'table') out += line('+', '-', '+', '+');
      if (box) out += line('└', '─', '┴', '┘');
      return out;
    }
  }
}

/** The "  SQL\n  ^--- error here" lines the CLI prints under a parse error. */
function errorContext(sql: string, e: SqlError): string {
  if (e.kind !== 'parse' || e.offset === undefined) return '';
  const base = e.stmtStart ?? 0;
  let z = sql.slice(base);
  let off = e.offset - base;
  if (off < 0 || off >= z.length) return '';
  if (off > 50) {
    z = z.slice(off - 50);
    off = 50;
  }
  const code = z.slice(0, 78).replace(/\s/g, ' ');
  if (off < 25) return `\n  ${code}\n  ${' '.repeat(off)}^--- error here`;
  return `\n  ${code}\n  ${' '.repeat(off - 14)}error here ---^`;
}

/** Split a dot-command line into arguments, honouring quotes. */
function dotArgs(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    const q = line[i];
    if (q === '"' || q === "'") {
      let j = i + 1;
      let s = '';
      while (j < line.length && line[j] !== q) {
        if (q === '"' && line[j] === '\\' && j + 1 < line.length) {
          s += line[j] + line[j + 1];
          j += 2;
          continue;
        }
        s += line[j++];
      }
      out.push(q === '"' ? unescape(s) : s);
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      out.push(line.slice(i, j));
      i = j;
    }
  }
  return out;
}

function tablesColumns(names: string[]): string {
  if (!names.length) return '';
  const maxlen = Math.max(...names.map(width));
  const ncol = Math.max(1, Math.floor(80 / (maxlen + 2)));
  const nrow = Math.ceil(names.length / ncol);
  let out = '';
  for (let i = 0; i < nrow; i++) {
    let line = '';
    for (let j = i; j < names.length; j += nrow) line += (j === i ? '' : '  ') + padRight(names[j], maxlen);
    out += line + '\n';
  }
  return out;
}

export const sqlite3: Command = (ctx) => {
  const s: Settings = { mode: 'list', header: false, headerSet: false, colSep: '|', rowSep: '\n', nullValue: '' };
  let file: string | null = null;
  const sqls: string[] = [];
  let readonly = false;
  const args = ctx.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) {
      if (file === null) file = a;
      else sqls.push(a);
      continue;
    }
    const z = a.startsWith('--') ? a.slice(1) : a;
    const value = (): string | null => {
      if (i + 1 >= args.length) {
        ctx.err(`sqlite3: Error: missing argument to ${a}\n`);
        return null;
      }
      return args[++i];
    };
    switch (z) {
      case '-header':
      case '-headers':
        s.header = true;
        s.headerSet = true;
        break;
      case '-noheader':
      case '-noheaders':
        s.header = false;
        s.headerSet = true;
        break;
      case '-list':
      case '-column':
      case '-json':
      case '-line':
      case '-box':
      case '-table':
      case '-markdown':
      case '-tabs':
      case '-quote':
        s.mode = z.slice(1) as Mode;
        break;
      case '-csv':
        s.mode = 'csv';
        s.colSep = ',';
        break;
      case '-separator':
      case '-newline':
      case '-nullvalue':
      case '-cmd': {
        const v = value();
        if (v === null) return 1;
        if (z === '-separator') s.colSep = unescape(v);
        else if (z === '-newline') s.rowSep = unescape(v);
        else if (z === '-nullvalue') s.nullValue = unescape(v);
        else sqls.unshift(v);
        break;
      }
      case '-readonly':
        readonly = true;
        break;
      case '-bail':
      case '-batch':
      case '-safe':
      case '-echo':
      case '-nofollow':
        break;
      case '-version':
        ctx.out(SQLITE_VERSION_LINE + '\n');
        return 0;
      case '-help':
        ctx.err(HELP);
        return 0;
      default:
        ctx.err(`sqlite3: Error: unknown option: ${a}\nUse -help for a list of options.\n`);
        return 1;
    }
  }
  if (s.mode === 'column' && !s.headerSet) s.header = true;

  if (sqls.length === 0 && ctx.stdinIsTty) {
    ctx.err(
      `SQLite version ${SQLITE_VERSION_LINE.split(' ').slice(0, 3).join(' ')}\n` +
        `sqlite3: this terminal cannot run the interactive prompt; pass the SQL as an argument:\n` +
        `  sqlite3 ${file ?? 'prod.db'} "SELECT * FROM users;"\n`,
    );
    return 1;
  }

  // ---- open the database ---------------------------------------------------------------
  const name = file ?? ':memory:';
  let path: string | null = null;
  let text = '';
  if (name !== ':memory:' && name !== '') {
    path = abs(ctx, name);
    const st = ctx.fs.stat(path);
    const parent = ctx.fs.stat(dirname(path));
    if ((st && st.type === 'dir') || (!st && (!parent || parent.type !== 'dir' || readonly))) {
      ctx.err(`Error: unable to open database "${name}": unable to open database file\n`);
      return 1;
    }
    if (st) text = ctx.fs.readFile(path);
  }
  let db: Database;
  try {
    db = Database.load(text, { now: ctx.state.now, readonly });
  } catch (e) {
    if (!(e instanceof SqlError)) throw e;
    ctx.err(`Parse error: file is not a database (26)\n`);
    return 1;
  }
  const before = db.dump();

  // ---- run -----------------------------------------------------------------------------
  let quit = false;
  let exitCode = 0;

  const runSql = (sql: string, line: number | null): boolean => {
    try {
      db.execStream(sql, (r) => ctx.out(render(r, s)));
      return true;
    } catch (e) {
      if (!(e instanceof SqlError)) throw e;
      const type = e.kind === 'parse' ? 'Parse error' : 'Runtime error';
      const code = (e.code ?? 1) > 1 ? ` (${e.code})` : '';
      ctx.err(`${type}${line !== null ? ` near line ${line}` : ''}: ${e.message}${code}${errorContext(sql, e)}\n`);
      return false;
    }
  };

  const runScript = (script: string): boolean => {
    const lines = script.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    let buf = '';
    let start = 0;
    for (let i = 0; i < lines.length && !quit; i++) {
      const line = lines[i];
      if (buf === '' && (line.startsWith('.') || line.startsWith('#'))) {
        if (line.startsWith('#')) continue;
        if (!dot(line)) return false;
        continue;
      }
      if (buf === '') {
        if (line.trim() === '') continue;
        start = i + 1;
        buf = line.trimStart();
      } else {
        buf += '\n' + line;
      }
      if (isComplete(buf)) {
        if (!runSql(buf, start)) return false;
        buf = '';
      }
    }
    if (!quit && buf.trim() !== '') return runSql(buf, start);
    return true;
  };

  const bool = (v: string): boolean | null => {
    const l = v.toLowerCase();
    if (['on', 'yes', 'true', '1'].includes(l)) return true;
    if (['off', 'no', 'false', '0'].includes(l)) return false;
    return null;
  };

  const usage = (text: string): boolean => {
    ctx.err(`Usage: ${text}\n`);
    return false;
  };

  /** Run a dot-command. Returns false on error. */
  const dot = (line: string): boolean => {
    const argv = dotArgs(line.trim());
    const cmd = argv[0].slice(1);
    const rest = argv.slice(1);
    const is = (full: string, min = 1) => cmd.length >= min && full.startsWith(cmd);
    if (cmd === '') {
      ctx.err(`Error: unknown command or invalid arguments:  "". Enter ".help" for help\n`);
      return false;
    }
    if (is('tables', 2) || is('indexes', 3) || is('indices', 3)) {
      const tables = cmd.startsWith('ta');
      let names: string[];
      if (tables) {
        names = db.schema().filter((o) => o.type !== 'index' && !o.name.toLowerCase().startsWith('sqlite_')).map((o) => o.name);
        if (rest[0]) names = names.filter((n) => like(rest[0], n, '\\'));
        names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        ctx.out(tablesColumns(names));
      } else {
        names = db.schema().filter((o) => o.type === 'index' && (!rest[0] || like(rest[0], o.tblName, '\\'))).map((o) => o.name);
        if (names.length) ctx.out(names.join('\n') + '\n');
      }
      return true;
    }
    if (is('schema', 2)) {
      const pattern = rest.find((r) => !r.startsWith('--')) ?? null;
      for (const o of db.schema()) {
        if (pattern !== null && !like(pattern, o.name, '\\') && !like(pattern, o.tblName, '\\')) continue;
        ctx.out(o.sql + ';\n');
      }
      return true;
    }
    if (is('dump', 1)) {
      const pats = rest.filter((r) => !r.startsWith('--'));
      ctx.out(db.dump(pats.length ? pats : undefined));
      return true;
    }
    if (is('headers', 2) || cmd === 'header') {
      if (rest.length !== 1) return usage('.headers on|off');
      const b = bool(rest[0]);
      if (b === null) ctx.err(`ERROR: Not a boolean value: "${rest[0]}". Assuming "no".\n`);
      s.header = !!b;
      s.headerSet = true;
      return true;
    }
    if (is('mode', 3)) {
      if (rest.length === 0) {
        ctx.out(`current output mode: ${s.mode}\n`);
        return true;
      }
      const m = rest[0].toLowerCase();
      const found = (MODES as readonly string[]).find((x) => x === m) ?? (m === 'columns' ? 'column' : undefined);
      if (!found) {
        ctx.err('Error: mode should be one of: ascii box column count csv html insert json line list markdown off qbox quote table tabs tcl\n');
        return false;
      }
      s.mode = found as Mode;
      if (s.mode === 'csv') {
        s.colSep = ',';
        s.rowSep = '\r\n';
      } else if (s.mode === 'list') {
        s.colSep = '|';
        s.rowSep = '\n';
      } else if (s.mode === 'tabs') {
        s.colSep = '\t';
      }
      if (s.mode === 'column' && !s.headerSet) s.header = true;
      return true;
    }
    if (is('nullvalue', 1)) {
      if (rest.length !== 1) return usage('.nullvalue STRING');
      s.nullValue = rest[0];
      return true;
    }
    if (is('separator', 2)) {
      if (rest.length < 1 || rest.length > 2) return usage('.separator COL ?ROW?');
      s.colSep = rest[0];
      if (rest[1] !== undefined) s.rowSep = rest[1];
      return true;
    }
    if (is('help', 1)) {
      ctx.out(DOT_HELP);
      return true;
    }
    if (is('quit', 1) || is('exit', 2)) {
      quit = true;
      if (cmd.startsWith('e') && rest[0] !== undefined) exitCode = Math.trunc(Number(rest[0])) || 0;
      return true;
    }
    if (is('print', 2)) {
      ctx.out(rest.join(' ') + '\n');
      return true;
    }
    if (is('databases', 2)) {
      ctx.out(`main: ${path ?? ''} ${readonly ? 'r/o' : 'r/w'}\n`);
      return true;
    }
    if (is('show', 2)) {
      const q = (v: string) => JSON.stringify(v);
      ctx.out(
        `        echo: off\n         eqp: off\n     explain: auto\n     headers: ${s.header ? 'on' : 'off'}\n` +
          `        mode: ${s.mode}\n   nullvalue: ${q(s.nullValue)}\n      output: stdout\n` +
          `colseparator: ${q(s.colSep)}\nrowseparator: ${q(s.rowSep)}\n       stats: off\n       width: \n    filename: ${name}\n`,
      );
      return true;
    }
    if (is('read', 2)) {
      if (rest.length !== 1) return usage('.read FILE');
      const p = abs(ctx, rest[0]);
      const st = ctx.fs.stat(p);
      if (!st || st.type !== 'file') {
        ctx.err(`Error: cannot open "${rest[0]}"\n`);
        return false;
      }
      return runScript(ctx.fs.readFile(p));
    }
    if (is('width', 1) || is('timer', 2) || is('bail', 2) || is('echo', 2) || is('changes', 2) || is('eqp', 2)) return true;
    ctx.err(`Error: unknown command or invalid arguments:  "${cmd}". Enter ".help" for help\n`);
    return false;
  };

  let ok = true;
  if (sqls.length) {
    for (const sql of sqls) {
      ok = sql.trimStart().startsWith('.') ? dot(sql.trimStart()) : runSql(sql, null);
      if (!ok || quit) break;
    }
  } else {
    ok = runScript(ctx.stdin);
  }

  // Closing the connection rolls back an open transaction; only real changes touch the file.
  db.rollbackOpen();
  if (path) {
    const after = db.dump();
    if (after !== before) ctx.fs.writeFile(path, after);
  }
  return ok ? exitCode : 1;
};
