// Shell builtins and small utilities: pwd, cd, whoami, date, help, clear, editors, true, false.

import type { Command } from './context.ts';
import { abs, DAY_NAMES, MONTH_NAMES, pad2, statArg } from './context.ts';
import { errorText } from '../vfs.ts';
import { dirname } from '../path.ts';

export const pwd: Command = (ctx) => {
  ctx.out(ctx.state.cwd + '\n');
  return 0;
};

export const cd: Command = (ctx) => {
  const args = ctx.args[0] === '--' ? ctx.args.slice(1) : ctx.args;
  if (args.length > 1) {
    ctx.err('bash: cd: too many arguments\n');
    return 1;
  }
  let target = args[0] ?? ctx.state.home;
  let announce = false;
  if (target === '-') {
    if (ctx.state.oldpwd === null) {
      ctx.err('bash: cd: OLDPWD not set\n');
      return 1;
    }
    target = ctx.state.oldpwd;
    announce = true;
  }
  if (target === '') return 0;
  const st = statArg(ctx, target);
  if (typeof st === 'string') {
    ctx.err(`bash: cd: ${target}: ${errorText(st)}\n`);
    return 1;
  }
  if (st.type !== 'dir') {
    ctx.err(`bash: cd: ${target}: Not a directory\n`);
    return 1;
  }
  ctx.state.oldpwd = ctx.state.cwd;
  ctx.state.cwd = abs(ctx, target);
  if (announce) ctx.out(ctx.state.cwd + '\n');
  return 0;
};

export const whoami: Command = (ctx) => {
  if (ctx.args.length > 0) {
    ctx.err(`whoami: extra operand ‘${ctx.args[0]}’\nTry 'whoami --help' for more information.\n`);
    return 1;
  }
  ctx.out(ctx.state.user + '\n');
  return 0;
};

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(ms: number, format: string): string {
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  const H = d.getUTCHours();
  const startOfYear = Date.UTC(Y, 0, 1);
  return format.replace(/%([a-zA-Z%])/g, (m, f: string) => {
    switch (f) {
      case 'Y': return String(Y);
      case 'y': return pad2(Y % 100);
      case 'm': return pad2(d.getUTCMonth() + 1);
      case 'd': return pad2(d.getUTCDate());
      case 'e': return String(d.getUTCDate()).padStart(2, ' ');
      case 'H': return pad2(H);
      case 'I': return pad2(H % 12 || 12);
      case 'M': return pad2(d.getUTCMinutes());
      case 'S': return pad2(d.getUTCSeconds());
      case 'p': return H < 12 ? 'AM' : 'PM';
      case 'a': return DAY_NAMES[d.getUTCDay()];
      case 'A': return FULL_DAYS[d.getUTCDay()];
      case 'b': case 'h': return MONTH_NAMES[d.getUTCMonth()];
      case 'B': return FULL_MONTHS[d.getUTCMonth()];
      case 'j': return String(Math.floor((ms - startOfYear) / 86400000) + 1).padStart(3, '0');
      case 's': return String(Math.floor(ms / 1000));
      case 'N': return String((ms % 1000) * 1000000).padStart(9, '0');
      case 'Z': return 'UTC';
      case 'z': return '+0000';
      case 'F': return `${Y}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      case 'T': return `${pad2(H)}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
      case 'D': return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}/${pad2(Y % 100)}`;
      case 'R': return `${pad2(H)}:${pad2(d.getUTCMinutes())}`;
      case 'n': return '\n';
      case 't': return '\t';
      case '%': return '%';
      default: return m;
    }
  });
}

export const date: Command = (ctx) => {
  let format = '%a %b %e %H:%M:%S %Z %Y';
  for (const a of ctx.args) {
    if (a === '-u' || a === '--utc' || a === '--universal') continue;
    if (a === '-I' || a === '--iso-8601') {
      format = '%F';
      continue;
    }
    if (a === '-R' || a === '--rfc-email') {
      format = '%a, %d %b %Y %H:%M:%S +0000';
      continue;
    }
    if (a.startsWith('+')) {
      format = a.slice(1);
      continue;
    }
    if (a.startsWith('-')) {
      ctx.err(`date: invalid option -- '${a.slice(1, 2)}'\nTry 'date --help' for more information.\n`);
      return 1;
    }
    ctx.err(`date: invalid date ‘${a}’\n`);
    return 1;
  }
  ctx.out(formatDate(ctx.state.now(), format) + '\n');
  return 0;
};

const DESCRIPTIONS: Record<string, string> = {
  websearch: 'search the web: websearch QUERY',
  curl: 'fetch a web page as text: curl URL',
  pwd: 'print the current directory',
  cd: 'change directory (cd, cd -, cd ~)',
  ls: 'list files (-l, -a, -A, -1, -d, -h)',
  mkdir: 'make directories (-p)',
  rmdir: 'remove empty directories',
  touch: 'create files or update their time',
  cat: 'print files (-n)',
  echo: 'print arguments (-n, -e)',
  printf: 'formatted print (%s, %d, \\n, …)',
  rm: 'remove files (-r, -f)',
  mv: 'move or rename',
  cp: 'copy (-r)',
  chmod: 'change mode (755, u+x, -R)',
  head: 'first lines (-n)',
  tail: 'last lines (-n, -n +N)',
  wc: 'count lines, words, bytes (-l, -w, -c)',
  grep: 'search text (-i, -n, -v, -r, -c, -l, -E, -F, -w)',
  find: 'find files (-name, -iname, -type, -maxdepth)',
  tree: 'show a directory tree (-a, -d, -L)',
  stat: 'show file details',
  sort: 'sort lines (-r, -n, -u)',
  uniq: 'drop repeated lines (-c, -d, -u)',
  whoami: 'print your user name',
  date: 'print the date (+FORMAT)',
  sqlite3: 'query a SQLite database (sqlite3 FILE "SQL")',
  clear: 'clear the screen',
  nano: 'edit a file (also: edit, vi, vim)',
  help: 'this list',
  true: 'do nothing, successfully',
  false: 'do nothing, unsuccessfully',
};

const HIDDEN_FROM_HELP = new Set(['edit', 'vi', 'vim']);

export const help: Command = (ctx) => {
  const names = ctx.commandNames().filter((n) => !HIDDEN_FROM_HELP.has(n)).sort();
  const width = Math.max(...names.map((n) => n.length)) + 2;
  let text = 'Available commands:\n';
  for (const n of names) text += `  ${n.padEnd(width)}${DESCRIPTIONS[n] ?? ''}`.trimEnd() + '\n';
  text += '\nOperators: |  &&  ||  ;  >  >>  <  2>  2>&1  &>\n';
  text += 'Quoting: \'single\', "double", backslash. Expansion: ~, *, ?, [abc], {a,b}, {1..3}, $HOME, $PWD, $?\n';
  ctx.out(text);
  return 0;
};

export const clear: Command = (ctx) => {
  ctx.setAction({ type: 'clear' });
  return 0;
};

export const edit: Command = (ctx) => {
  const files = ctx.args.filter((a) => !a.startsWith('-') || a === '-');
  if (files.length === 0) {
    ctx.err(`${ctx.name}: missing file operand\n`);
    return 1;
  }
  if (files.length > 1) {
    ctx.err(`${ctx.name}: only one file at a time\n`);
    return 1;
  }
  const file = files[0];
  const st = statArg(ctx, file);
  if (typeof st !== 'string' && st.type === 'dir') {
    ctx.err(`${ctx.name}: ${file}: Is a directory\n`);
    return 1;
  }
  if (typeof st === 'string' && st !== 'ENOENT') {
    ctx.err(`${ctx.name}: ${file}: ${errorText(st)}\n`);
    return 1;
  }
  const path = abs(ctx, file);
  if (typeof st === 'string') {
    // The file may be new, but its directory has to exist for the save to work.
    const parent = ctx.fs.stat(dirname(path));
    if (!parent || parent.type !== 'dir') {
      ctx.err(`${ctx.name}: ${file}: ${errorText(parent ? 'ENOTDIR' : 'ENOENT')}\n`);
      return 1;
    }
  }
  ctx.setAction({ type: 'edit', path });
  return 0;
};

export const trueCmd: Command = () => 0;
export const falseCmd: Command = () => 1;

