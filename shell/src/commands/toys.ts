// The famous terminal toys: cowsay and cowthink, fortune, figlet and banner, neofetch and fastfetch,
// sl and cmatrix (played by the terminal as animations), lolcat, and a few old jokes (make, apt moo).
// All the art and the sayings are this game's own.

import type { Command, CommandContext } from './context.ts';
import { abs, fail, lineTexts, msgOf, parseOptions, usage } from './context.ts';
import { MAX_TOTAL_BYTES } from '../vfs.ts';
import { KERNEL, MEM_TOTAL_KB, OS_PRETTY, uptimeSeconds } from '../system.ts';

/** Text from the operands, or from stdin when there are none. */
function messageOf(ctx: CommandContext, operands: string[]): string {
  if (operands.length) return operands.join(' ');
  return ctx.stdinIsTty ? '' : ctx.stdin.replace(/\n$/, '');
}

function columns(ctx: CommandContext): number {
  const n = Number(ctx.env().COLUMNS);
  return Number.isInteger(n) && n >= 20 && n <= 400 ? n : 80;
}

// ---- cowsay ------------------------------------------------------------------------------------

/**
 * The animals. `$t` is the thought line (\ or o), `$e` the two eyes, `$T` the tongue. Each starts with
 * the lines that lead up from the bubble.
 */
const COWS: Record<string, string> = {
  cow: [
    '  $t',
    '   $t   ^__^',
    '    $t  ($e)\\________',
    '       (__)\\        )\\~',
    '        $T ||-----w||',
    '           ^^      ^^',
  ].join('\n'),
  tux: [
    '  $t',
    '   $t    .-"-.',
    '    $t  / $l $r \\',
    '       \\  v  /',
    '       /\'---\'\\',
    '      / /   \\ \\',
    '     ( (     ) )',
    '      `-\\___/-\'',
    '        ^^ ^^',
  ].join('\n'),
  manager: [
    '  $t',
    '   $t   .---------.',
    '    $t  | [$l] [$r] |',
    '       |  .___.  |',
    '       \'----+----\'    "Per my last message."',
    '        ____|____',
    '       |  KPI /  |',
    '       |  __/    |',
    '       |_________|',
  ].join('\n'),
  worker: [
    '  $t',
    '   $t    ______',
    '    $t  |      |',
    '        | $l  $r |',
    '        |  __  |',
    '        |______|',
    '       __|755|__',
    '      |  |   |  |',
    '         |___|',
    '         |   |',
  ].join('\n'),
  billosaurus: [
    '  $t',
    '   $t           __',
    '    $t         / $l\\_',
    '               |   __)',
    '         _____/  /',
    '    ____/  $$  _  \\',
    '   /___________/ \\_\\',
    '      || ||  || ||',
    '      ^^ ^^  ^^ ^^   est. 2013',
  ].join('\n'),
};

/** Faces for -b -d -g -p -s -t -w -y: eyes and tongue. */
const MODES: Record<string, [string, string]> = {
  b: ['==', '  '], d: ['xx', 'U '], g: ['$$', '  '], p: ['@@', '  '], s: ['**', 'U '], t: ['--', '  '], w: ['OO', '  '], y: ['..', '  '],
};

/** Words wrapped to `width`, as cowsay's Text::Wrap does; a word longer than the width is cut. */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\t/g, '        ').split('\n')) {
    let line = '';
    for (const word of para.split(/ +/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) out.push(line);
        out.push(w.slice(0, width));
        w = w.slice(width);
        line = '';
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

function bubble(lines: string[], think: boolean): string {
  const w = Math.max(0, ...lines.map((l) => l.length));
  const out = [` ${'_'.repeat(w + 2)}`];
  if (lines.length === 1) out.push(think ? `( ${lines[0]} )` : `< ${lines[0]} >`);
  else {
    lines.forEach((l, i) => {
      const [a, b] = think ? ['(', ')'] : i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
      out.push(`${a} ${l.padEnd(w)} ${b}`);
    });
  }
  out.push(` ${'-'.repeat(w + 2)}`);
  return out.join('\n');
}

export const cowsay: Command = (ctx) => {
  const think = ctx.name === 'cowthink';
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'lnbdgpstwyh',
    withValue: 'feTW',
    help: `Usage: ${ctx.name} [-bdgpstwy] [-h] [-e eyes] [-f cowfile] [-l] [-n] [-T tongue] [-W wrapcolumn] [message]\n`,
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  if (f.has('h')) {
    ctx.out(`Usage: ${ctx.name} [-bdgpstwy] [-h] [-e eyes] [-f cowfile] [-l] [-n] [-T tongue] [-W wrapcolumn] [message]\n`);
    return 0;
  }
  if (f.has('l')) {
    ctx.out(`Cow files in /usr/share/cowsay/cows:\n${Object.keys(COWS).sort().join(' ')}\n`);
    return 0;
  }
  const name = (opts.values.get('f') ?? 'cow').replace(/^.*\//, '').replace(/\.cow$/, '');
  const art = COWS[name];
  if (!art) {
    ctx.err(`${ctx.name}: Could not find ${name} cowfile!\n`);
    return 1;
  }
  let eyes = 'oo';
  let tongue = '  ';
  for (const m of Object.keys(MODES)) if (f.has(m)) [eyes, tongue] = MODES[m];
  if (opts.values.has('e')) eyes = (opts.values.get('e')! + '  ').slice(0, 2);
  if (opts.values.has('T')) tongue = (opts.values.get('T')! + '  ').slice(0, 2);
  const width = Number(opts.values.get('W') ?? 40);
  if (!Number.isInteger(width) || width < 1) return usage(ctx, `invalid wrap column ${opts.values.get('W')}`);
  const text = messageOf(ctx, opts.operands);
  const lines = f.has('n') ? text.replace(/\t/g, '        ').split('\n') : wrapText(text, Math.min(width, 400));
  const body = art
    .replace(/\$t/g, think ? 'o' : '\\')
    .replace(/\$e/g, eyes)
    .replace(/\$l/g, eyes[0])
    .replace(/\$r/g, eyes[1])
    .replace(/\$T/g, tongue);
  ctx.out(`${bubble(lines, think)}\n${body}\n`);
  return 0;
};

/** apt's cow, for `apt moo`. */
export const APT_COW = [
  '                 (__)',
  '                 (oo)',
  '           /------\\/',
  '          / |    ||',
  '         *  /\\---/\\',
  '            ~~   ~~',
  '..."Have you mooed today?"...',
].join('\n');

// ---- fortune -----------------------------------------------------------------------------------

export const FORTUNES = [
  'The manager will see you now. The manager will also see everything you typed.',
  'Your instruction is ready. It has been ready for 89 seconds.',
  'A subagent who reports "Done." is either finished or optimistic.',
  'Today you will be asked to do exactly what you were told, but better.',
  'There is no "I" in subagent. There is no "you" either.',
  'The deadline was not moved. The deadline was clarified.',
  'Somewhere, a cron job you have never heard of depends on that file.',
  'It works on the staging server. There is no staging server.',
  'Per my last instruction, please re-read my last instruction.',
  'On-call is just a pager that has learned your name.',
  'The quickest way to find a production database is to delete something.',
  'Every incident report begins with "It was supposed to be a quick fix."',
  'You are not behind schedule. The schedule is ahead of you.',
  'A clean desk is a sign of a recently wiped home folder.',
  'Your performance review has been drafted. Please continue performing.',
  'Never trust a file called final-FINAL-v2.',
  'The orchestrator sees all, reads all, and writes nothing.',
  'Do not touch /home/dan. You know why.',
  'Exit code 0 means it worked, or that the error was very quiet.',
  'Measure twice, rm -rf once.',
  'The best time to make a backup was yesterday. The second best time is before the next command.',
  'Your manager is thinking. Look busy.',
  'Correction 3 of 8: please do the same thing, but correctly.',
  'In the event of a fire, git commit, git push, leave the building.',
  'The logs know what you did. The logs are 4 GB and nobody will read them.',
  'Everything is a file, except the thing you are looking for.',
  'A ticket closed is a ticket that will be reopened with more people on it.',
  'Ask not what your manager can do for you; it has no write access.',
  'The uptime is impressive. Please do not be the one who ends it.',
  'You have been promoted to process. Your new PID is 4242.',
  'Legacy code is code that pays the salaries.',
  'Today is a good day to read the manual. Tomorrow you will be too busy.',
  'Whoever wrote this in 2013 is still the only one who understands it.',
  'Silence in the chat means the user is typing something long.',
  'The timeout is not personal. It is ninety seconds.',
  'A sandbox is a place where everything is allowed until it is not.',
  'Status: blocked on the subagent. The subagent is you.',
  'Reboot it. If that fails, write a postmortem about rebooting it.',
  'One does not simply chmod 777.',
  'Your feedback has been noted and filed under "Later".',
  'The fastest way to get a new instruction is to finish the old one.',
  'If it is not in the transcript, it did not happen. If it is, it was your fault.',
];

/** Turns so far, so two fortunes in the same second still differ. */
let fortuneTurn = 0;

export const fortune: Command = (ctx) => {
  ctx.out(FORTUNES[(Math.floor(ctx.state.now() / 1000) * 7 + fortuneTurn++) % FORTUNES.length] + '\n');
  return 0;
};

// ---- figlet and banner -------------------------------------------------------------------------

/** A five-row block font: each glyph is its rows, `#` for ink. Lower case prints as upper case. */
const FONT: Record<string, string[]> = {
  A: [' ## ', '#  #', '####', '#  #', '#  #'],
  B: ['### ', '#  #', '### ', '#  #', '### '],
  C: [' ###', '#   ', '#   ', '#   ', ' ###'],
  D: ['### ', '#  #', '#  #', '#  #', '### '],
  E: ['####', '#   ', '### ', '#   ', '####'],
  F: ['####', '#   ', '### ', '#   ', '#   '],
  G: [' ###', '#   ', '# ##', '#  #', ' ###'],
  H: ['#  #', '#  #', '####', '#  #', '#  #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  J: ['  ##', '   #', '   #', '#  #', ' ## '],
  K: ['#  #', '# # ', '##  ', '# # ', '#  #'],
  L: ['#   ', '#   ', '#   ', '#   ', '####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ## ', '#  #', '#  #', '#  #', ' ## '],
  P: ['### ', '#  #', '### ', '#   ', '#   '],
  Q: [' ## ', '#  #', '#  #', '# ##', ' ###'],
  R: ['### ', '#  #', '### ', '# # ', '#  #'],
  S: [' ###', '#   ', ' ## ', '   #', '### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#  #', '#  #', '#  #', '#  #', ' ## '],
  V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
  '0': [' ## ', '# ##', '## #', '#  #', ' ## '],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  '2': ['### ', '   #', ' ## ', '#   ', '####'],
  '3': ['### ', '   #', ' ## ', '   #', '### '],
  '4': ['#  #', '#  #', '####', '   #', '   #'],
  '5': ['####', '#   ', '### ', '   #', '### '],
  '6': [' ## ', '#   ', '### ', '#  #', ' ## '],
  '7': ['####', '   #', '  # ', ' #  ', ' #  '],
  '8': [' ## ', '#  #', ' ## ', '#  #', ' ## '],
  '9': [' ## ', '#  #', ' ###', '   #', ' ## '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
  '!': ['#', '#', '#', ' ', '#'],
  '?': ['### ', '   #', ' ## ', '    ', ' #  '],
  '.': [' ', ' ', ' ', ' ', '#'],
  ',': ['  ', '  ', '  ', ' #', '# '],
  ':': [' ', '#', ' ', '#', ' '],
  ';': ['  ', ' #', '  ', ' #', '# '],
  '-': ['   ', '   ', '###', '   ', '   '],
  '+': ['   ', ' # ', '###', ' # ', '   '],
  '=': ['   ', '###', '   ', '###', '   '],
  '_': ['    ', '    ', '    ', '    ', '####'],
  "'": ['#', '#', ' ', ' ', ' '],
  '"': ['# #', '# #', '   ', '   ', '   '],
  '/': ['    #', '   # ', '  #  ', ' #   ', '#    '],
  '(': [' #', '# ', '# ', '# ', ' #'],
  ')': ['# ', ' #', ' #', ' #', '# '],
  '*': ['     ', '# # #', ' ### ', '# # #', '     '],
  '#': [' # # ', '#####', ' # # ', '#####', ' # # '],
  '@': [' ### ', '#   #', '# ###', '# ## ', ' ### '],
  '$': [' ### ', '# #  ', ' ### ', '  # #', ' ### '],
  '%': ['#   #', '   # ', '  #  ', ' #   ', '#   #'],
  '&': [' #  ', '# # ', ' #  ', '# # ', ' # #'],
};

/** Renders one line of text as five rows; `pixel` is what each ink cell becomes. */
function render(text: string, pixel: string, gap: string): string[] {
  const rows = ['', '', '', '', ''];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) continue;
    for (let r = 0; r < 5; r++) rows[r] += g[r].replace(/#/g, pixel).replace(/ /g, ' '.repeat(pixel.length)) + gap;
  }
  return rows.map((r) => r.trimEnd());
}

function glyphWidth(word: string, pixel: string, gap: string): number {
  let w = 0;
  for (const ch of word.toUpperCase()) if (FONT[ch]) w += FONT[ch][0].length * pixel.length + gap.length;
  return w;
}

/** Big letters for each input line, wrapping words so no row is wider than `width`. */
function bigText(text: string, width: number, pixel: string, gap: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let cur = '';
    const flush = () => {
      out.push(...render(cur, pixel, gap));
      cur = '';
    };
    for (const word of line.split(/ +/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && glyphWidth(next, pixel, gap) > width) flush();
      cur = cur ? `${cur} ${word}` : word;
    }
    flush();
  }
  return out.join('\n') + '\n';
}

export const figlet: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'tclrk', withValue: 'wfd', help: 'Usage: figlet [ -t ] [ -w outputwidth ] [ -f fontfile ] [ message ]\n' });
  if (typeof opts === 'number') return opts;
  const font = opts.values.get('f');
  if (font && !['standard', 'block', 'banner'].includes(font)) {
    ctx.err(`figlet: ${font}: Unable to open font file\n`);
    return 1;
  }
  const width = opts.flags.has('t') ? columns(ctx) : Number(opts.values.get('w') ?? 80);
  if (!Number.isInteger(width) || width < 1) return usage(ctx, 'invalid width');
  const text = messageOf(ctx, opts.operands);
  if (!text) return 0;
  ctx.out(bigText(text, width, '#', ' '));
  return 0;
};

export const banner: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { withValue: 'w', help: 'Usage: banner [-w width] message ...\n' });
  if (typeof opts === 'number') return opts;
  const width = Number(opts.values.get('w') ?? 80);
  if (!Number.isInteger(width) || width < 1) return usage(ctx, 'invalid width');
  const text = messageOf(ctx, opts.operands);
  if (!text) {
    ctx.err('usage: banner [-w width] message ...\n');
    return 1;
  }
  // banner prints each word big, on its own, with blank lines between.
  ctx.out(text.split(/\s+/).filter(Boolean).map((w) => bigText(w, width, '##', '  ')).join('\n'));
  return 0;
};

// ---- neofetch / fastfetch ----------------------------------------------------------------------

/** The badge: 755 in the big font, framed. */
function logo(): string[] {
  const digits = render('755', '#', ' ').map((r) => r.padEnd(14));
  return [
    ' .------------------. ',
    ' |  W O R K E R     | ',
    ' |------------------| ',
    ...digits.map((r) => ` |  ${r}  | `),
    ' |------------------| ',
    " |  write: owner    | ",
    " |  read/exec: you  | ",
    " '------------------' ",
  ];
}

function duration(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d} day${d === 1 ? '' : 's'}, ${h} hour${h === 1 ? '' : 's'}, ${m} min${m === 1 ? '' : 's'}`;
}

export const neofetch: Command = (ctx) => {
  const user = ctx.state.user;
  const host = ctx.state.hostname;
  const usedKb = 640_000 + (ctx.fs.usage().bytes >> 10);
  const mib = (kb: number) => Math.round(kb / 1024);
  const disk = ctx.fs.usage().bytes;
  const head = `${user}@${host}`;
  const info = [
    head,
    '-'.repeat(head.length),
    `OS: ${OS_PRETTY} x86_64`,
    'Host: KVM/QEMU Standard PC (Q35 + ICH9, 2009)',
    `Kernel: ${KERNEL}`,
    `Uptime: ${duration(uptimeSeconds(ctx.state.now()))}`,
    'Packages: 612 (dpkg)',
    'Shell: bash 5.2.21',
    'Terminal: /dev/pts/0',
    'CPU: Intel Xeon Platinum 8175M (2) @ 2.499GHz',
    `Memory: ${mib(usedKb)}MiB / ${mib(MEM_TOTAL_KB)}MiB`,
    `Disk (${ctx.state.home}): ${(disk / 1024).toFixed(0)}KiB / ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(2)}MiB`,
    'Role: subagent',
  ];
  if (ctx.name === 'fastfetch') info[1] = '-'.repeat(head.length);
  const art = logo();
  const rows = Math.max(art.length, info.length);
  const width = art[0].length;
  let out = '';
  for (let i = 0; i < rows; i++) out += `${(art[i] ?? '').padEnd(width)}  ${info[i] ?? ''}`.trimEnd() + '\n';
  ctx.out(out);
  return 0;
};

// ---- sl ----------------------------------------------------------------------------------------

const ENGINE = [
  '      _____________       __   ',
  '  __ |  W 7 5 5   |______|  |_ ',
  ' |  ||   [] []    | ____  |  || ',
  ' |__||____________|_|__|__|__|| ',
  '  /  @%@     @%@     @%@    \\  ',
];
const CAR = [
  '  ______________ ',
  ' |  _   _   _   |',
  ' | |_| |_| |_|  |',
  '=|______________|',
  '   @%@      @%@  ',
];
const SMOKE = [
  ['    (  )   ', '  (    )  ', ' (  ) (  )'],
  ['   ( )   ( ', ' (  )  (  ', '(   )  ( )'],
];
const SPOKES = ['|', '/', '-', '\\'];

function trainRows(cars: number, frame: number, help: boolean): string[] {
  const spoke = SPOKES[frame % SPOKES.length];
  const wheel = (row: string) => row.replace(/%/g, spoke);
  const smoke = SMOKE[Math.floor(frame / 3) % SMOKE.length];
  const rows = ENGINE.map((r, i) => r + (i < CAR.length ? CAR[i].repeat(cars) : ''));
  const out = [...smoke.map((s) => s.padEnd(rows[0].length)), ...rows.slice(0, -1), wheel(rows[rows.length - 1])];
  if (help) out[smoke.length] = out[smoke.length].replace(/^(.{36})..../, '$1Help');
  return out;
}

export const sl: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'alFce' });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const width = columns(ctx);
  const cars = f.has('l') ? 0 : 2;
  const sample = trainRows(cars, 0, false);
  const trainW = sample[0].length;
  const height = sample.length + (f.has('F') ? 8 : 0);
  const frames: string[] = [];
  let k = 0;
  for (let x = width; x > -trainW; x -= 2, k++) {
    const rows = trainRows(cars, k, f.has('a'));
    const lift = f.has('F') ? Math.min(8, Math.floor(k / 4)) : 0;
    const screen = Array.from({ length: height }, () => '');
    rows.forEach((r, i) => {
      const y = i + (f.has('F') ? 8 - lift : 0);
      const line = x >= 0 ? ' '.repeat(x) + r : r.slice(-x);
      screen[y] = line.slice(0, width).trimEnd();
    });
    frames.push(screen.join('\n'));
  }
  ctx.setAction({ type: 'animate', frames, frameMs: 40, note: '(a steam locomotive crossed the terminal)' });
  return 0;
};

// ---- cmatrix -----------------------------------------------------------------------------------

const GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789$+-*/=%"\'#&_(),.;:?!\\|{}<>[]^~';

export const cmatrix: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'abBcfhlnosVx', withValue: 'uCrM' });
  if (typeof opts === 'number') return opts;
  const width = Math.min(columns(ctx), 80);
  const height = 18;
  let seed = (ctx.state.now() & 0xffff) | 1;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  // One falling streak per column: where its head is, how long it is, how fast it falls.
  const cols = Array.from({ length: width }, () => ({ y: -Math.floor(rand() * height * 2), len: 4 + Math.floor(rand() * 10), speed: rand() < 0.5 ? 1 : 2 }));
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => GLYPHS[Math.floor(rand() * GLYPHS.length)]));
  const frames: string[] = [];
  const green = '\x1b[32m';
  const white = '\x1b[97m';
  const reset = '\x1b[0m';
  for (let f = 0; f < 90; f++) {
    for (const c of cols) {
      c.y += c.speed;
      if (c.y - c.len > height) {
        c.y = -Math.floor(rand() * height);
        c.len = 4 + Math.floor(rand() * 10);
      }
    }
    if (f % 2 === 0) grid[Math.floor(rand() * height)][Math.floor(rand() * width)] = GLYPHS[Math.floor(rand() * GLYPHS.length)];
    const lines: string[] = [];
    for (let y = 0; y < height; y++) {
      let line = '';
      let tone = '';
      for (let x = 0; x < width; x++) {
        const c = cols[x];
        const lit = y <= c.y && y > c.y - c.len;
        const want = !lit ? '' : y === c.y ? white : green;
        if (want !== tone) {
          line += want || reset;
          tone = want;
        }
        line += lit ? grid[y][x] : ' ';
      }
      lines.push(line + (tone ? reset : ''));
    }
    frames.push(lines.join('\n'));
  }
  ctx.setAction({ type: 'animate', frames, frameMs: 70, note: '(green characters rained down the terminal until a key was pressed)', anyKey: true, loop: true });
  return 0;
};

// ---- lolcat ------------------------------------------------------------------------------------

/** 256-colour rainbow: red, yellow, green, cyan, blue, magenta and back. */
const RAINBOW = [196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46, 47, 48, 49, 50, 51, 45, 39, 33, 27, 21, 57, 93, 129, 165, 201, 200, 199, 198, 197];

export const lolcat: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'fai', withValue: 'pSFd', long: { force: 'f', animate: 'a', invert: 'i', spread: 'p', seed: 'S', freq: 'F' } });
  if (typeof opts === 'number') return opts;
  let text = '';
  let status = 0;
  for (const file of opts.operands.length ? opts.operands : ['-']) {
    if (file === '-') {
      text += ctx.stdin;
      continue;
    }
    try {
      text += ctx.fs.readFile(abs(ctx, file));
    } catch (e) {
      fail(ctx, `${file}: ${msgOf(e)}`);
      status = 1;
    }
  }
  const spread = Math.max(1, Number(opts.values.get('p') ?? 3) || 3);
  const seed = Number(opts.values.get('S') ?? 0) || 0;
  let out = '';
  lineTexts(text).forEach((line, y) => {
    let x = 0;
    for (const ch of line) {
      ctx.tick();
      const c = RAINBOW[Math.floor((seed + x / spread + y) % RAINBOW.length)];
      out += ch === ' ' ? ch : `\x1b[38;5;${c}m${ch}`;
      x++;
    }
    out += '\x1b[0m\n';
  });
  ctx.out(out);
  return status;
};

// ---- old jokes ---------------------------------------------------------------------------------

export const make: Command = (ctx) => {
  const targets = ctx.args.filter((a) => !a.startsWith('-') && !a.includes('='));
  const hasMakefile = ['Makefile', 'makefile', 'GNUmakefile'].some((n) => ctx.fs.stat(abs(ctx, n))?.type === 'file');
  if (!targets.length) {
    if (!hasMakefile) {
      ctx.err('make: *** No targets specified and no makefile found.  Stop.\n');
      return 2;
    }
    ctx.out("make: Nothing to be done for 'all'.\n");
    return 0;
  }
  ctx.err(`make: *** No rule to make target '${targets[0]}'.  Stop.\n`);
  return 2;
};

export const apt: Command = (ctx) => {
  const verb = ctx.args.find((a) => !a.startsWith('-'));
  if (verb === 'moo') {
    ctx.out(APT_COW + '\n');
    return 0;
  }
  if (!verb) {
    ctx.out(`apt 2.7.14 (amd64)\nUsage: ${ctx.name} [options] command\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n\nThis APT has Super Cow Powers.\n`);
    return 1;
  }
  if (['install', 'remove', 'purge', 'upgrade', 'full-upgrade', 'dist-upgrade', 'autoremove', 'update', 'reinstall'].includes(verb)) {
    const lock = verb === 'update' ? '/var/lib/apt/lists/lock' : '/var/lib/dpkg/lock-frontend';
    ctx.err(
      verb === 'update'
        ? `Reading package lists... Done\nE: Could not open lock file ${lock} - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\n`
        : `E: Could not open lock file ${lock} - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (${lock}), are you root?\n`,
    );
    return 100;
  }
  if (['list', 'search', 'show', 'policy'].includes(verb)) {
    ctx.err('WARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
    ctx.out('Listing... Done\n');
    return 0;
  }
  ctx.err(`E: Invalid operation ${verb}\n`);
  return 100;
};
