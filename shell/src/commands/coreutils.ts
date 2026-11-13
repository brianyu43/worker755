// More coreutils and friends: cut, tr, tee, diff, cmp, comm, paste, rev, tac, nl, seq, yes, column,
// fold, shuf, expr, base64, checksums, xxd/od/hexdump, strings, basename, dirname, realpath,
// readlink, mktemp, file, xargs, printenv, timeout, nohup, sleep, ln, less/more, tput, bc.

import type { Command, CommandContext } from './context.ts';
import { abs, fail, lineTexts, lq, msgOf, parseOptions, q, splitLines, statArg, usage } from './context.ts';
import { readInput } from './text.ts';
import { errorText } from '../vfs.ts';
import { basename as base, dirname as dir } from '../path.ts';
import { md5, sha1, sha256 } from './hash.ts';

/** Text of each operand (stdin when none), or null after printing an error. */
function inputs(ctx: CommandContext, files: string[]): { name: string; text: string }[] | null {
  const out: { name: string; text: string }[] = [];
  let bad = false;
  for (const f of files.length ? files : ['-']) {
    const input = readInput(ctx, f);
    if (!input.ok) {
      fail(ctx, `${f}: ${errorText(input.code)}`);
      bad = true;
      continue;
    }
    out.push({ name: f, text: input.text });
  }
  return bad && !out.length ? null : out;
}

// ---- cut ---------------------------------------------------------------------------------

function parseList(spec: string): ((n: number) => boolean) | null {
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
    if (a < 1) return null;
    ranges.push([a, b]);
  }
  return (n) => ranges.some(([a, b]) => n >= a && n <= b);
}

export const cut: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'snz',
    withValue: 'dfcb',
    long: { delimiter: 'd', fields: 'f', characters: 'c', bytes: 'b', 'only-delimited': 's', complement: 'C', 'output-delimiter': 'O' },
  });
  if (typeof opts === 'number') return opts;
  const field = opts.values.get('f');
  const chars = opts.values.get('c') ?? opts.values.get('b');
  if (!field && !chars) return usage(ctx, 'you must specify a list of bytes, characters, or fields');
  const list = parseList((field ?? chars)!);
  if (!list) {
    ctx.err(`cut: invalid field value ${lq((field ?? chars)!)}\nTry 'cut --help' for more information.\n`);
    return 1;
  }
  const complement = opts.flags.has('C');
  const pick = (n: number) => list(n) !== complement;
  const delim = opts.values.get('d') ?? '\t';
  if (field && [...delim].length !== 1) {
    ctx.err("cut: the delimiter must be a single character\nTry 'cut --help' for more information.\n");
    return 1;
  }
  const outDelim = opts.values.get('O') ?? delim;
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  let out = '';
  for (const { text } of files) {
    for (const line of lineTexts(text)) {
      if (chars) {
        out += [...line].filter((_, i) => pick(i + 1)).join('') + '\n';
        continue;
      }
      if (!line.includes(delim)) {
        if (!opts.flags.has('s')) out += line + '\n';
        continue;
      }
      out += line.split(delim).filter((_, i) => pick(i + 1)).join(outDelim) + '\n';
    }
  }
  ctx.out(out);
  return 0;
};

// ---- tr ----------------------------------------------------------------------------------

const TR_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: ' \t\n\r\f\v', blank: ' \t',
  punct: '!-/:-@[-`{-~', xdigit: '0-9A-Fa-f', cntrl: '\x00-\x1f\x7f', print: ' -~', graph: '!-~',
};

/** Expand a tr set (ranges, classes, escapes, [c*n]) into characters. */
function trSet(spec: string, fillTo = 0): string[] | string {
  const out: string[] = [];
  const unesc = (s: string, i: number): [string, number] => {
    if (s[i] !== '\\' || i + 1 >= s.length) return [s[i], 1];
    const e = s[i + 1];
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: '\x07', b: '\b', '\\': '\\' };
    if (map[e]) return [map[e], 2];
    const m = /^[0-7]{1,3}/.exec(s.slice(i + 1));
    if (m) return [String.fromCharCode(parseInt(m[0], 8)), 1 + m[0].length];
    return [e, 2];
  };
  let i = 0;
  while (i < spec.length) {
    const cls = /^\[:([a-z]+):\]/.exec(spec.slice(i));
    if (cls) {
      const body = TR_CLASSES[cls[1]];
      if (!body) return `invalid character class ${lq(cls[1])}`;
      const expanded = trSet(body);
      if (typeof expanded === 'string') return expanded;
      out.push(...expanded);
      i += cls[0].length;
      continue;
    }
    const rep = /^\[(.)\*(\d*)\]/.exec(spec.slice(i));
    if (rep) {
      const n = rep[2] ? Number(rep[2]) : Math.max(0, fillTo - out.length);
      for (let k = 0; k < n && k < 100000; k++) out.push(rep[1]);
      i += rep[0].length;
      continue;
    }
    const [c, used] = unesc(spec, i);
    if (spec[i + used] === '-' && i + used + 1 < spec.length) {
      const [d, used2] = unesc(spec, i + used + 1);
      const a = c.codePointAt(0)!;
      const b = d.codePointAt(0)!;
      if (b < a) return `range-endpoints of '${c}-${d}' are in reverse collating sequence order`;
      for (let k = a; k <= b; k++) out.push(String.fromCodePoint(k));
      i += used + 1 + used2;
      continue;
    }
    out.push(c);
    i += used;
  }
  return out;
}

export const tr: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'cCdst', long: { complement: 'c', delete: 'd', 'squeeze-repeats': 's', 'truncate-set1': 't' } });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const [s1, s2] = opts.operands;
  if (s1 === undefined) return usage(ctx, 'missing operand');
  const del = f.has('d');
  const squeeze = f.has('s');
  if (!del && !squeeze && s2 === undefined) return usage(ctx, `missing operand after ${lq(s1)}\nTwo strings must be given when translating.`);
  if (opts.operands.length > (del && !squeeze ? 1 : 2)) return usage(ctx, `extra operand ${lq(opts.operands[del && !squeeze ? 1 : 2])}`);
  const set1 = trSet(s1);
  if (typeof set1 === 'string') {
    ctx.err(`tr: ${set1}\n`);
    return 1;
  }
  const set2raw = s2 !== undefined ? trSet(s2, set1.length) : [];
  if (typeof set2raw === 'string') {
    ctx.err(`tr: ${set2raw}\n`);
    return 1;
  }
  const complement = f.has('c') || f.has('C');
  const in1 = new Set(set1);
  const member = (c: string) => in1.has(c) !== complement;
  const map = new Map<string, string>();
  if (!del && s2 !== undefined && !complement) {
    const set2 = [...set2raw];
    while (set2.length && set2.length < set1.length) set2.push(set2[set2.length - 1]);
    set1.forEach((c, i) => map.set(c, set2[i] ?? c));
  }
  const last2 = set2raw[set2raw.length - 1];
  const squeezeSet = new Set(del ? set2raw : s2 !== undefined ? set2raw : set1);
  let out = '';
  let prev = '';
  for (const c of ctx.stdin) {
    let ch: string | null = c;
    if (del) {
      if (member(c)) ch = null;
    } else if (s2 !== undefined) {
      if (complement) {
        if (member(c)) ch = last2 ?? c;
      } else if (map.has(c)) ch = map.get(c)!;
    }
    if (ch === null) continue;
    if (squeeze && ch === prev && (s2 !== undefined || del ? squeezeSet.has(ch) : member(ch))) continue;
    out += ch;
    prev = ch;
  }
  ctx.out(out);
  return 0;
};

// ---- tee ---------------------------------------------------------------------------------

export const tee: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'aip', long: { append: 'a', 'ignore-interrupts': 'i' } });
  if (typeof opts === 'number') return opts;
  let status = 0;
  for (const f of opts.operands) {
    const p = abs(ctx, f);
    if (p === '/dev/stdout' || p === '/dev/tty') {
      ctx.out(ctx.stdin);
      continue;
    }
    if (p === '/dev/stderr') {
      ctx.err(ctx.stdin);
      continue;
    }
    try {
      if (opts.flags.has('a')) ctx.fs.appendFile(p, ctx.stdin);
      else ctx.fs.writeFile(p, ctx.stdin);
    } catch (e) {
      const st = statArg(ctx, f);
      fail(ctx, `${f}: ${typeof st !== 'string' && st.type === 'dir' ? 'Is a directory' : errorText((e as { code?: 'ENOENT' }).code ?? 'ENOENT')}`);
      status = 1;
    }
  }
  ctx.out(ctx.stdin);
  return status;
};

// ---- diff / cmp / comm -------------------------------------------------------------------

type Op = { kind: 'same' | 'del' | 'add'; a: number; b: number };

/** Myers diff over lines; null when the inputs are too different to compare cheaply. */
function diffLines(a: string[], b: string[], ctx: CommandContext): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const limit = Math.min(max, 4000);
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let found = false;
  for (let d = 0; d <= limit; d++) {
    ctx.tick();
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return null;
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', a: --x, b: --y });
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: 'add', a: x, b: --y });
      else ops.push({ kind: 'del', a: --x, b: y });
    }
  }
  return ops.reverse();
}

interface Hunk {
  a0: number;
  a1: number; // exclusive
  b0: number;
  b1: number;
}

function hunks(ops: Op[]): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === 'same') {
      i++;
      continue;
    }
    const h: Hunk = { a0: ops[i].a, a1: ops[i].a, b0: ops[i].b, b1: ops[i].b };
    while (i < ops.length && ops[i].kind !== 'same') {
      if (ops[i].kind === 'del') h.a1 = ops[i].a + 1;
      else h.b1 = ops[i].b + 1;
      i++;
    }
    out.push(h);
  }
  return out;
}

const range = (a: number, b: number) => (b - a <= 1 ? String(b - a === 1 ? a + 1 : a) : `${a + 1},${b}`);

function stamp(ctx: CommandContext, path: string | null): string {
  const st = path ? ctx.fs.stat(path) : null;
  const d = new Date(st?.mtime ?? ctx.state.now());
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.000000000 +0000`;
}

export const diff: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'uqsrNiwbBayc',
    withValue: 'U',
    invalidExit: 2,
    long: { unified: 'u', brief: 'q', 'report-identical-files': 's', recursive: 'r', 'new-file': 'N', 'ignore-case': 'i', 'ignore-all-space': 'w', 'ignore-space-change': 'b', 'side-by-side': 'y', text: 'a', color: 'K' },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  if (opts.operands.length < 2) {
    ctx.err(`diff: missing operand after ${lq(opts.operands[0] ?? 'diff')}\ndiff: Try 'diff --help' for more information.\n`);
    return 2;
  }
  if (opts.operands.length > 2) {
    ctx.err(`diff: extra operand ${lq(opts.operands[2])}\ndiff: Try 'diff --help' for more information.\n`);
    return 2;
  }
  const context = opts.values.has('U') ? Number(opts.values.get('U')) : 3;
  const unified = f.has('u') || opts.values.has('U');
  const norm = (l: string) => {
    let s = l;
    if (f.has('i')) s = s.toLowerCase();
    if (f.has('w')) s = s.replace(/\s+/g, '');
    else if (f.has('b')) s = s.replace(/\s+/g, ' ').replace(/ $/, '');
    return s;
  };
  const compare = (nameA: string, nameB: string, textA: string, textB: string, pathA: string | null, pathB: string | null): number => {
    if (textA === textB) {
      if (f.has('s')) ctx.out(`Files ${nameA} and ${nameB} are identical\n`);
      return 0;
    }
    const la = lineTexts(textA);
    const lb = lineTexts(textB);
    const ops = diffLines(la.map(norm), lb.map(norm), ctx);
    if (ops && !ops.some((o) => o.kind !== 'same')) return 0;
    if (f.has('q') || !ops) {
      ctx.out(`Files ${nameA} and ${nameB} differ\n`);
      return 1;
    }
    const hs = hunks(ops);
    const noEolA = textA !== '' && !textA.endsWith('\n');
    const noEolB = textB !== '' && !textB.endsWith('\n');
    let out = '';
    if (unified) {
      out += `--- ${nameA}\t${stamp(ctx, pathA)}\n+++ ${nameB}\t${stamp(ctx, pathB)}\n`;
      // Merge hunks whose context overlaps.
      const groups: Hunk[][] = [];
      for (const h of hs) {
        const g = groups[groups.length - 1];
        if (g && h.a0 - g[g.length - 1].a1 <= context * 2) g.push(h);
        else groups.push([h]);
      }
      for (const g of groups) {
        const a0 = Math.max(0, g[0].a0 - context);
        const b0 = Math.max(0, g[0].b0 - context);
        const a1 = Math.min(la.length, g[g.length - 1].a1 + context);
        const b1 = Math.min(lb.length, g[g.length - 1].b1 + context);
        const fmt = (s: number, e: number) => (e - s === 1 ? String(s + 1) : `${e - s === 0 ? s : s + 1},${e - s}`);
        out += `@@ -${fmt(a0, a1)} +${fmt(b0, b1)} @@\n`;
        let ai = a0;
        let bi = b0;
        for (const h of g) {
          while (ai < h.a0) {
            out += ` ${la[ai++]}\n`;
            bi++;
          }
          for (let i = h.a0; i < h.a1; i++) out += `-${la[i]}\n` + (noEolA && i === la.length - 1 ? '\\ No newline at end of file\n' : '');
          for (let i = h.b0; i < h.b1; i++) out += `+${lb[i]}\n` + (noEolB && i === lb.length - 1 ? '\\ No newline at end of file\n' : '');
          ai = h.a1;
          bi = h.b1;
        }
        while (ai < a1) out += ` ${la[ai++]}\n`;
        void bi;
        void b1;
      }
    } else {
      for (const h of hs) {
        const del = h.a1 > h.a0;
        const add = h.b1 > h.b0;
        const kind = del && add ? 'c' : del ? 'd' : 'a';
        const ar = kind === 'a' ? String(h.a0) : range(h.a0, h.a1);
        const br = kind === 'd' ? String(h.b0) : range(h.b0, h.b1);
        out += `${ar}${kind}${br}\n`;
        for (let i = h.a0; i < h.a1; i++) out += `< ${la[i]}\n` + (noEolA && i === la.length - 1 ? '\\ No newline at end of file\n' : '');
        if (del && add) out += '---\n';
        for (let i = h.b0; i < h.b1; i++) out += `> ${lb[i]}\n` + (noEolB && i === lb.length - 1 ? '\\ No newline at end of file\n' : '');
      }
    }
    ctx.out(out);
    return 1;
  };
  const [a, b] = opts.operands;
  const read = (arg: string): { text: string; path: string | null; isDir: boolean } | null => {
    if (arg === '-') return { text: ctx.stdin, path: null, isDir: false };
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      ctx.err(`diff: ${arg}: ${errorText(st)}\n`);
      return null;
    }
    return { text: st.type === 'dir' ? '' : ctx.fs.readFile(st.path), path: st.path, isDir: st.type === 'dir' };
  };
  const ra = read(a);
  const rb = read(b);
  if (!ra || !rb) return 2;
  if (ra.isDir && rb.isDir) {
    let status = 0;
    const walk = (pa: string, pb: string, shownA: string, shownB: string) => {
      const na = new Set(ctx.fs.list(pa).map((e) => base(e.path)));
      const nb = new Set(ctx.fs.list(pb).map((e) => base(e.path)));
      for (const name of [...new Set([...na, ...nb])].sort()) {
        const sa = ctx.fs.stat(`${pa}/${name}`);
        const sb = ctx.fs.stat(`${pb}/${name}`);
        if (!sa || !sb) {
          ctx.out(`Only in ${!sa ? shownB : shownA}: ${name}\n`);
          status = 1;
          continue;
        }
        if (sa.type === 'dir' && sb.type === 'dir') {
          if (f.has('r')) walk(sa.path, sb.path, `${shownA}/${name}`, `${shownB}/${name}`);
          else ctx.out(`Common subdirectories: ${shownA}/${name} and ${shownB}/${name}\n`);
          continue;
        }
        if (sa.type !== sb.type) {
          ctx.out(`File ${shownA}/${name} is a ${sa.type === 'dir' ? 'directory' : 'regular file'} while file ${shownB}/${name} is a ${sb.type === 'dir' ? 'directory' : 'regular file'}\n`);
          status = 1;
          continue;
        }
        const ta = ctx.fs.readFile(sa.path);
        const tb = ctx.fs.readFile(sb.path);
        if (ta !== tb && !f.has('q')) ctx.out(`diff ${unified ? '-u ' : ''}${shownA}/${name} ${shownB}/${name}\n`);
        if (compare(`${shownA}/${name}`, `${shownB}/${name}`, ta, tb, sa.path, sb.path)) status = 1;
      }
    };
    walk(ra.path!, rb.path!, a.replace(/\/+$/, ''), b.replace(/\/+$/, ''));
    return status;
  }
  if (ra.isDir || rb.isDir) {
    const [d, file] = ra.isDir ? [a, b] : [b, a];
    const inner = `${d.replace(/\/+$/, '')}/${base(file)}`;
    const st = statArg(ctx, inner);
    if (typeof st === 'string') {
      ctx.err(`diff: ${inner}: ${errorText(st)}\n`);
      return 2;
    }
    const t = ctx.fs.readFile(st.path);
    return ra.isDir ? compare(inner, b, t, rb.text, st.path, rb.path) : compare(a, inner, ra.text, t, ra.path, st.path);
  }
  return compare(a, b, ra.text, rb.text, ra.path, rb.path);
};

export const cmp: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'sl', long: { silent: 's', quiet: 's', verbose: 'l' }, invalidExit: 2 });
  if (typeof opts === 'number') return opts;
  const [a, b = '-'] = opts.operands;
  if (a === undefined) {
    ctx.err("cmp: missing operand after 'cmp'\ncmp: Try 'cmp --help' for more information.\n");
    return 2;
  }
  const ia = readInput(ctx, a);
  const ib = readInput(ctx, b);
  if (!ia.ok || !ib.ok) {
    const [name, r] = !ia.ok ? [a, ia] : [b, ib];
    ctx.err(`cmp: ${name}: ${errorText((r as { code: 'ENOENT' }).code)}\n`);
    return 2;
  }
  const ta = ia.text;
  const tb = ib.text;
  if (ta === tb) return 0;
  if (opts.flags.has('s')) return 1;
  let i = 0;
  let line = 1;
  while (i < ta.length && i < tb.length && ta[i] === tb[i]) {
    if (ta[i] === '\n') line++;
    i++;
  }
  if (i >= ta.length || i >= tb.length) ctx.err(`cmp: EOF on ${i >= ta.length ? a : b} after byte ${i}, line ${line - (i > 0 && (i >= ta.length ? ta : tb)[i - 1] === '\n' ? 1 : 0)}\n`);
  else ctx.out(`${a} ${b} differ: byte ${i + 1}, line ${line}\n`);
  return 1;
};

export const comm: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: '123i' });
  if (typeof opts === 'number') return opts;
  const [a, b] = opts.operands;
  if (b === undefined) return usage(ctx, `missing operand after ${lq(a ?? 'comm')}`);
  const ia = readInput(ctx, a);
  const ib = readInput(ctx, b);
  if (!ia.ok) return (fail(ctx, `${a}: ${errorText(ia.code)}`), 1);
  if (!ib.ok) return (fail(ctx, `${b}: ${errorText(ib.code)}`), 1);
  const la = lineTexts(ia.text);
  const lb = lineTexts(ib.text);
  const hide = opts.flags;
  const col = (n: number, s: string) => {
    if (hide.has(String(n))) return '';
    let pre = '';
    for (let k = 1; k < n; k++) if (!hide.has(String(k))) pre += '\t';
    return pre + s + '\n';
  };
  let i = 0;
  let j = 0;
  let out = '';
  while (i < la.length || j < lb.length) {
    if (j >= lb.length || (i < la.length && la[i] < lb[j])) out += col(1, la[i++]);
    else if (i >= la.length || lb[j] < la[i]) out += col(2, lb[j++]);
    else {
      out += col(3, la[i]);
      i++;
      j++;
    }
  }
  ctx.out(out);
  return 0;
};

// ---- small text filters ------------------------------------------------------------------

export const paste: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'sz', withValue: 'd', long: { delimiters: 'd', serial: 's' } });
  if (typeof opts === 'number') return opts;
  const delims = [...(opts.values.get('d') ?? '\t').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\0/g, '')];
  const d = (i: number) => (delims.length ? delims[i % delims.length] : '');
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  let out = '';
  if (opts.flags.has('s')) {
    for (const { text } of files) out += lineTexts(text).map((l, i) => (i ? d(i - 1) : '') + l).join('') + '\n';
  } else {
    const cols = files.map((f) => lineTexts(f.text));
    const rows = Math.max(0, ...cols.map((c) => c.length));
    for (let r = 0; r < rows; r++) out += cols.map((c, i) => (i ? d(i - 1) : '') + (c[r] ?? '')).join('') + '\n';
  }
  ctx.out(out);
  return 0;
};

export const rev: Command = (ctx) => {
  const files = inputs(ctx, ctx.args);
  if (!files) return 1;
  ctx.out(files.map(({ text }) => splitLines(text).map((l) => {
    const nl = l.endsWith('\n');
    return [...(nl ? l.slice(0, -1) : l)].reverse().join('') + (nl ? '\n' : '');
  }).join('')).join(''));
  return 0;
};

export const tac: Command = (ctx) => {
  const files = inputs(ctx, ctx.args.filter((a) => a !== '-r'));
  if (!files) return 1;
  ctx.out(files.map(({ text }) => {
    const lines = splitLines(text);
    if (lines.length && !lines[lines.length - 1].endsWith('\n')) lines[lines.length - 1] += '\n';
    return lines.reverse().join('');
  }).join(''));
  return 0;
};

export const nl: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { withValue: 'bwsv', long: { 'body-numbering': 'b', 'number-width': 'w', 'number-separator': 's', 'starting-line-number': 'v' } });
  if (typeof opts === 'number') return opts;
  const all = opts.values.get('b') === 'a';
  const width = Number(opts.values.get('w') ?? 6);
  const sep = opts.values.get('s') ?? '\t';
  let n = Number(opts.values.get('v') ?? 1);
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  let out = '';
  for (const { text } of files) {
    for (const line of lineTexts(text)) {
      if (line === '' && !all) out += ' '.repeat(width + sep.length) + '\n';
      else out += `${String(n++).padStart(width)}${sep}${line}\n`;
    }
  }
  ctx.out(out.replace(/ +\n/g, (m) => (all ? m : '\n')));
  return 0;
};

export const seq: Command = (ctx) => {
  const args = [...ctx.args];
  let sep = '\n';
  let width = false;
  let format: string | null = null;
  while (args.length && /^-[swf]/.test(args[0]) && !/^-\d/.test(args[0])) {
    const a = args.shift()!;
    if (a === '-w') width = true;
    else if (a.startsWith('-s')) sep = a.length > 2 ? a.slice(2) : args.shift() ?? '';
    else if (a.startsWith('-f')) format = a.length > 2 ? a.slice(2) : args.shift() ?? '';
  }
  if (!args.length) return usage(ctx, 'missing operand');
  if (args.length > 3) return usage(ctx, `extra operand ${lq(args[3])}`);
  const nums = args.map(Number);
  const bad = args.find((a, i) => !Number.isFinite(nums[i]) || a.trim() === '');
  if (bad !== undefined) return usage(ctx, `invalid floating point argument: ${lq(bad)}`);
  const [first, step, last] = args.length === 1 ? [1, 1, nums[0]] : args.length === 2 ? [nums[0], 1, nums[1]] : [nums[0], nums[1], nums[2]];
  if (step === 0) return usage(ctx, `invalid Zero increment value: ${lq(args[1])}`);
  const decimals = Math.max(...args.map((a) => (a.includes('.') ? a.split('.')[1].length : 0)));
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const v = first + i * step;
    if (step > 0 ? v > last + 1e-9 : v < last - 1e-9) break;
    if (i % 1024 === 0) ctx.tick();
    if (out.length > 1_000_000) break;
    out.push(format ? format.replace(/%(\.\d+)?[gfe]/, (_m, p: string | undefined) => (p ? v.toFixed(Number(p.slice(1))) : String(v))) : v.toFixed(decimals));
  }
  if (width) {
    const w = Math.max(...out.map((s) => s.length));
    for (let i = 0; i < out.length; i++) out[i] = out[i].startsWith('-') ? '-' + out[i].slice(1).padStart(w - 1, '0') : out[i].padStart(w, '0');
  }
  if (out.length) ctx.out(out.join(sep) + '\n');
  return 0;
};

export const yes: Command = (ctx) => {
  const line = (ctx.args.length ? ctx.args.join(' ') : 'y') + '\n';
  const chunk = line.repeat(Math.max(1, Math.floor(8192 / line.length)));
  // Writes until whatever reads it is full; a terminal would scroll forever.
  for (let i = 0; i < 100_000 && !ctx.outputFull(); i++) {
    ctx.tick();
    ctx.out(chunk);
  }
  return 0;
};

export const column: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'tnx', withValue: 'sco', long: { table: 't', separator: 's', 'output-separator': 'o' } });
  if (typeof opts === 'number') return opts;
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  const lines = files.flatMap((f) => lineTexts(f.text)).filter((l) => l.trim() !== '');
  if (!opts.flags.has('t')) {
    ctx.out(lines.map((l) => l + '\n').join(''));
    return 0;
  }
  const sep = opts.values.get('s');
  const outSep = opts.values.get('o') ?? '  ';
  const rows = lines.map((l) => (sep ? l.split(new RegExp(`[${sep.replace(/[\]\\^-]/g, '\\$&')}]`)) : l.trim().split(/\s+/)));
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, [...c].length)));
  ctx.out(rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c + ' '.repeat(widths[i] - [...c].length))).join(outSep).trimEnd() + '\n').join(''));
  return 0;
};

export const fold: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args.flatMap((a) => (/^-\d+$/.test(a) ? ['-w', a.slice(1)] : [a])), { flags: 'sb', withValue: 'w', long: { width: 'w', spaces: 's' } });
  if (typeof opts === 'number') return opts;
  const width = Number(opts.values.get('w') ?? 80);
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  let out = '';
  for (const { text } of files) {
    for (const l of splitLines(text)) {
      const nl = l.endsWith('\n');
      let line = nl ? l.slice(0, -1) : l;
      while ([...line].length > width) {
        let cut = width;
        if (opts.flags.has('s')) {
          const sp = line.slice(0, width).lastIndexOf(' ');
          if (sp > 0) cut = sp + 1;
        }
        out += line.slice(0, cut) + '\n';
        line = line.slice(cut);
      }
      out += line + (nl ? '\n' : '');
    }
  }
  ctx.out(out);
  return 0;
};

export const shuf: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'erz', withValue: 'niov', long: { 'head-count': 'n', 'input-range': 'i', echo: 'e', repeat: 'r' } });
  if (typeof opts === 'number') return opts;
  let items: string[];
  if (opts.flags.has('e')) items = opts.operands;
  else if (opts.values.has('i')) {
    const m = /^(\d+)-(\d+)$/.exec(opts.values.get('i')!);
    if (!m || Number(m[2]) - Number(m[1]) > 1_000_000) return usage(ctx, `invalid input range: ${lq(opts.values.get('i')!)}`);
    items = [];
    for (let k = Number(m[1]); k <= Number(m[2]); k++) items.push(String(k));
  } else {
    const files = inputs(ctx, opts.operands);
    if (!files) return 1;
    items = files.flatMap((f) => lineTexts(f.text));
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const n = opts.values.has('n') ? Number(opts.values.get('n')) : items.length;
  ctx.out(items.slice(0, n).map((s) => s + '\n').join(''));
  return 0;
};

// ---- expr --------------------------------------------------------------------------------

export const expr: Command = (ctx) => {
  const t = ctx.args;
  let pos = 0;
  class ExprError extends Error {}
  const isInt = (s: string) => /^[-+]?\d+$/.test(s);
  const num = (s: string) => {
    if (!isInt(s)) throw new ExprError('non-integer argument');
    return BigInt(s);
  };
  const primary = (): string => {
    const a = t[pos++];
    if (a === undefined) throw new ExprError('syntax error: missing argument after ‘' + (t[pos - 2] ?? '') + '’');
    if (a === '(') {
      const v = orE();
      if (t[pos++] !== ')') throw new ExprError("syntax error: expecting ')'");
      return v;
    }
    if (a === 'length') return String([...primary()].length);
    if (a === 'substr') {
      const s = primary();
      const p = Number(primary());
      const l = Number(primary());
      return [...s].slice(p - 1, p - 1 + l).join('');
    }
    if (a === 'index') {
      const s = primary();
      const chars = primary();
      const i = [...s].findIndex((c) => chars.includes(c));
      return String(i + 1);
    }
    if (a === 'match') {
      const s = primary();
      return match(s, primary());
    }
    return a;
  };
  const match = (s: string, re: string): string => {
    const r = new RegExp('^(?:' + re.replace(/\\\(/g, '(').replace(/\\\)/g, ')') + ')');
    const m = r.exec(s);
    if (re.includes('\\(')) return m?.[1] ?? '';
    return String(m ? m[0].length : 0);
  };
  const colon = (): string => {
    let v = primary();
    while (t[pos] === ':') {
      pos++;
      v = match(v, primary());
    }
    return v;
  };
  const mul = (): string => {
    let v = colon();
    while (t[pos] === '*' || t[pos] === '/' || t[pos] === '%') {
      const op = t[pos++];
      const r = colon();
      const a = num(v);
      const b = num(r);
      if (op !== '*' && b === 0n) throw new ExprError('division by zero');
      v = String(op === '*' ? a * b : op === '/' ? a / b : a % b);
    }
    return v;
  };
  const add = (): string => {
    let v = mul();
    while (t[pos] === '+' || t[pos] === '-') {
      const op = t[pos++];
      const r = mul();
      v = String(op === '+' ? num(v) + num(r) : num(v) - num(r));
    }
    return v;
  };
  const cmpE = (): string => {
    let v = add();
    while (['<', '<=', '=', '==', '!=', '>=', '>'].includes(t[pos])) {
      const op = t[pos++];
      const r = add();
      const c = isInt(v) && isInt(r) ? (BigInt(v) < BigInt(r) ? -1 : BigInt(v) > BigInt(r) ? 1 : 0) : v < r ? -1 : v > r ? 1 : 0;
      const ok = op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '=' || op === '==' ? c === 0 : op === '!=' ? c !== 0 : op === '>=' ? c >= 0 : c > 0;
      v = ok ? '1' : '0';
    }
    return v;
  };
  const null_ = (v: string) => v === '' || (isInt(v) && BigInt(v) === 0n);
  const andE = (): string => {
    let v = cmpE();
    while (t[pos] === '&') {
      pos++;
      const r = cmpE();
      v = null_(v) || null_(r) ? '0' : v;
    }
    return v;
  };
  const orE = (): string => {
    let v = andE();
    while (t[pos] === '|') {
      pos++;
      const r = andE();
      v = null_(v) ? (null_(r) ? '0' : r) : v;
    }
    return v;
  };
  try {
    if (!t.length) throw new ExprError('missing operand');
    const v = orE();
    if (pos < t.length) throw new ExprError(`syntax error: unexpected argument ‘${t[pos]}’`);
    ctx.out(v + '\n');
    return null_(v) ? 1 : 0;
  } catch (e) {
    if (e instanceof ExprError) {
      ctx.err(`expr: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
};

// ---- encodings and checksums -------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes of text as the shell stores it: characters 0–255 are bytes, anything else is UTF-8. */
export function toBytes(text: string): Uint8Array {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\xff]*$/.test(text) && /[\x80-\xff]/.test(text) && !/[Ā-￿]/.test(text)) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(text);
}

/** Text for bytes: UTF-8 when valid, else one character per byte. */
export function fromBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

export const base64: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'di', withValue: 'w', long: { decode: 'd', wrap: 'w', 'ignore-garbage': 'i' } });
  if (typeof opts === 'number') return opts;
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  const text = files.map((f) => f.text).join('');
  if (opts.flags.has('d')) {
    const clean = text.replace(/[\s]/g, '');
    if (/[^A-Za-z0-9+/=]/.test(clean) && !opts.flags.has('i')) {
      ctx.err('base64: invalid input\n');
      return 1;
    }
    const s = clean.replace(/[^A-Za-z0-9+/]/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i += 4) {
      const n = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : -1));
      bytes.push((n[0] << 2) | (n[1] >> 4));
      if (n[2] >= 0) bytes.push(((n[1] & 15) << 4) | (n[2] >> 2));
      if (n[3] >= 0) bytes.push(((n[2] & 3) << 6) | n[3]);
    }
    ctx.out(fromBytes(new Uint8Array(bytes)));
    return 0;
  }
  const b = toBytes(text);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  const wrap = Number(opts.values.get('w') ?? 76);
  if (wrap > 0) out = out.replace(new RegExp(`(.{${wrap}})`, 'g'), '$1\n').replace(/\n$/, '');
  ctx.out(out + (out ? '\n' : ''));
  return 0;
};

function checksum(fn: (s: string) => string): Command {
  return (ctx) => {
    const opts = parseOptions(ctx, ctx.args, { flags: 'cbtzw', long: { check: 'c', binary: 'b', text: 't', quiet: 'q', status: 's' } });
    if (typeof opts === 'number') return opts;
    if (opts.flags.has('c')) {
      let status = 0;
      for (const { text } of inputs(ctx, opts.operands) ?? []) {
        for (const line of lineTexts(text)) {
          const m = /^([0-9a-f]+) [ *](.+)$/.exec(line);
          if (!m) continue;
          const input = readInput(ctx, m[2]);
          const ok = input.ok && fn(input.text) === m[1];
          ctx.out(`${m[2]}: ${input.ok ? (ok ? 'OK' : 'FAILED') : 'FAILED open or read'}\n`);
          if (!ok) status = 1;
        }
      }
      return status;
    }
    let status = 0;
    for (const f of opts.operands.length ? opts.operands : ['-']) {
      const input = readInput(ctx, f);
      if (!input.ok) {
        fail(ctx, `${f}: ${errorText(input.code)}`);
        status = 1;
        continue;
      }
      ctx.tick();
      ctx.out(`${fn(input.text)}  ${f}\n`);
    }
    return status;
  };
}

export const md5sum = checksum(md5);
export const sha1sum = checksum(sha1);
export const sha256sum = checksum(sha256);

export const cksum: Command = (ctx) => {
  const files = inputs(ctx, ctx.args);
  if (!files) return 1;
  for (const { name, text } of files) {
    const bytes = toBytes(text);
    let crc = 0;
    const feed = (b: number) => {
      crc ^= b << 24;
      for (let k = 0; k < 8; k++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    };
    for (const b of bytes) feed(b);
    for (let len = bytes.length; len > 0; len >>>= 8) feed(len & 0xff);
    ctx.out(`${(~crc) >>> 0} ${bytes.length}${name === '-' ? '' : ' ' + name}\n`);
  }
  return 0;
};

const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

export const xxd: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'pru', withValue: 'lcs' });
  if (typeof opts === 'number') return opts;
  const files = inputs(ctx, opts.operands.slice(0, 1));
  if (!files) return 2;
  const text = files[0].text;
  if (opts.flags.has('r')) {
    const hex = opts.flags.has('p') ? text.replace(/\s/g, '') : lineTexts(text).map((l) => l.replace(/^[0-9a-f]+: /, '').slice(0, 39).replace(/\s/g, '')).join('');
    const bytes = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    ctx.out(fromBytes(bytes));
    return 0;
  }
  let bytes = toBytes(text);
  if (opts.values.has('l')) bytes = bytes.slice(0, Number(opts.values.get('l')));
  const hx = (b: number) => b.toString(16).padStart(2, '0');
  if (opts.flags.has('p')) {
    let s = '';
    for (const b of bytes) s += hx(b);
    ctx.out(s.replace(/(.{60})/g, '$1\n').replace(/\n$/, '') + (s ? '\n' : ''));
    return 0;
  }
  let out = '';
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.slice(off, off + 16);
    let h = '';
    for (let i = 0; i < 16; i++) h += (i < row.length ? hx(row[i]) : '  ') + (i % 2 === 1 ? ' ' : '');
    out += `${off.toString(16).padStart(8, '0')}: ${h} ${[...row].map(printable).join('')}\n`;
    if (off % 16384 === 0) ctx.tick();
  }
  ctx.out(out);
  return 0;
};

export const hexdump: Command = (ctx) => {
  const files = inputs(ctx, ctx.args.filter((a) => !a.startsWith('-')));
  if (!files) return 1;
  const bytes = toBytes(files.map((f) => f.text).join(''));
  const hx = (b: number) => b.toString(16).padStart(2, '0');
  let out = '';
  for (let off = 0; off < bytes.length; off += 16) {
    const row = [...bytes.slice(off, off + 16)];
    const h = row.map(hx);
    out += `${off.toString(16).padStart(8, '0')}  ${h.slice(0, 8).join(' ').padEnd(23)}  ${h.slice(8).join(' ').padEnd(23)}  |${row.map(printable).join('')}|\n`;
    if (off % 16384 === 0) ctx.tick();
  }
  out += `${bytes.length.toString(16).padStart(8, '0')}\n`;
  ctx.out(out);
  return 0;
};

export const od: Command = (ctx) => {
  // -A RADIX for offsets (d, o, x, n); -c chars, -b octal bytes, -x hex shorts, -t x1|d1|o1|c|x2|o2; default octal shorts.
  let radix = 'o';
  let format = 'o2';
  const names: string[] = [];
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    const val = (opt: string) => (a.length > 2 ? a.slice(2) : ctx.args[++i] ?? '') || opt;
    if (a.startsWith('-A')) radix = val('o');
    else if (a.startsWith('-t')) format = val('o2').replace(/^([xdoc])$/, '$11').replace(/^c1$/, 'c');
    else if (a === '-c') format = 'c';
    else if (a === '-b') format = 'o1';
    else if (a === '-x') format = 'x2';
    else if (a === '-d') format = 'd2';
    else if (a.startsWith('-') && a !== '-') return usage(ctx, `invalid option -- '${a.slice(1, 2)}'`);
    else names.push(a);
  }
  if (!'doxn'.includes(radix) || radix.length !== 1) return usage(ctx, `invalid output address radix '${radix}'; it must be one character from [doxn]`);
  if (!/^(c|[xdo][12])$/.test(format)) return usage(ctx, `invalid type string ${lq(format)}`);
  const files = inputs(ctx, names);
  if (!files) return 1;
  const bytes = toBytes(files.map((f) => f.text).join(''));
  const offset = (n: number) => (radix === 'n' ? '' : radix === 'd' ? String(n).padStart(7, '0') : radix === 'x' ? n.toString(16).padStart(6, '0') : n.toString(8).padStart(7, '0'));
  const base = format[0] === 'x' ? 16 : format[0] === 'd' ? 10 : 8;
  const size = Number(format[1] ?? 1);
  const width = size === 1 ? (base === 16 ? 2 : base === 10 ? 4 : 3) : base === 16 ? 4 : 6;
  let out = '';
  for (let off = 0; off < bytes.length; off += 16) {
    ctx.tick();
    const row = [...bytes.slice(off, off + 16)];
    let cells = '';
    if (format === 'c') {
      const named: Record<number, string> = { 10: '\\n', 9: '\\t', 13: '\\r', 0: '\\0', 7: '\\a', 8: '\\b', 12: '\\f', 11: '\\v' };
      cells = row.map((b) => (named[b] ?? (b >= 32 && b < 127 ? String.fromCharCode(b) : b.toString(8).padStart(3, '0'))).padStart(4)).join('');
    } else {
      for (let i = 0; i < row.length; i += size) {
        const v = size === 2 ? row[i] | ((row[i + 1] ?? 0) << 8) : row[i];
        cells += ' ' + v.toString(base).padStart(width, base === 10 ? ' ' : '0');
      }
    }
    out += `${offset(off)}${cells}\n`;
  }
  if (radix !== 'n') out += `${offset(bytes.length)}\n`;
  ctx.out(out);
  return 0;
};

export const strings: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'a', withValue: 'n' });
  if (typeof opts === 'number') return opts;
  const min = Number(opts.values.get('n') ?? 4);
  const files = inputs(ctx, opts.operands);
  if (!files) return 1;
  const re = new RegExp(`[\\x20-\\x7e\\t]{${min},}`, 'g');
  ctx.out(files.flatMap((f) => f.text.match(re) ?? []).map((s) => s + '\n').join(''));
  return 0;
};

// ---- names and paths ---------------------------------------------------------------------

export const basename: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'az', withValue: 's', long: { multiple: 'a', suffix: 's', zero: 'z' } });
  if (typeof opts === 'number') return opts;
  const ops = opts.operands;
  if (!ops.length) return usage(ctx, 'missing operand');
  const multiple = opts.flags.has('a') || opts.values.has('s');
  let suffix = opts.values.get('s') ?? '';
  let names = ops;
  if (!multiple) {
    if (ops.length > 2) return usage(ctx, `extra operand ${lq(ops[2])}`);
    suffix = ops[1] ?? '';
    names = [ops[0]];
  }
  for (const n of names) {
    let b = n.replace(/\/+$/, '');
    b = b === '' ? (n.startsWith('/') ? '/' : '') : b.slice(b.lastIndexOf('/') + 1);
    if (suffix && b !== suffix && b.endsWith(suffix)) b = b.slice(0, -suffix.length);
    ctx.out(b + '\n');
  }
  return 0;
};

export const dirname: Command = (ctx) => {
  const ops = ctx.args.filter((a) => a !== '-z');
  if (!ops.length) return usage(ctx, 'missing operand');
  for (const n of ops) {
    const t = n.replace(/\/+$/, '');
    if (t === '') {
      ctx.out((n.startsWith('/') ? '/' : '.') + '\n');
      continue;
    }
    const i = t.lastIndexOf('/');
    ctx.out((i < 0 ? '.' : i === 0 ? '/' : t.slice(0, i).replace(/\/+$/, '') || '/') + '\n');
  }
  return 0;
};

export const realpath: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'emsqLPz', withValue: '', long: { 'canonicalize-existing': 'e', 'canonicalize-missing': 'm', quiet: 'q', 'no-symlinks': 's' } });
  if (typeof opts === 'number') return opts;
  if (!opts.operands.length) return usage(ctx, 'missing operand');
  let status = 0;
  for (const a of opts.operands) {
    const p = abs(ctx, a);
    const parent = ctx.fs.stat(dir(p));
    if (!opts.flags.has('m') && ((opts.flags.has('e') && !ctx.fs.exists(p)) || !parent || parent.type !== 'dir')) {
      if (!opts.flags.has('q')) ctx.err(`${ctx.name}: ${a}: No such file or directory\n`);
      status = 1;
      continue;
    }
    ctx.out(p + '\n');
  }
  return status;
};

export const readlink: Command = (ctx) => {
  const canon = ctx.args.some((a) => /^-[a-zA-Z]*[fem]/.test(a) || a === '--canonicalize');
  const ops = ctx.args.filter((a) => !a.startsWith('-'));
  if (!ops.length) return usage(ctx, 'missing operand');
  if (!canon) return 1; // nothing here is a symbolic link
  for (const a of ops) ctx.out(abs(ctx, a) + '\n');
  return 0;
};

let tmpCounter = 0;

export const mktemp: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'dqut', withValue: 'p', long: { directory: 'd', quiet: 'q', tmpdir: 'p', 'dry-run': 'u' } });
  if (typeof opts === 'number') return opts;
  const template = opts.operands[0] ?? 'tmp.XXXXXXXXXX';
  const m = /X{3,}$/.exec(template.replace(/(\.[^./]*)$/, ''));
  if (!m) {
    ctx.err(`mktemp: too few X's in template ${lq(template)}\n`);
    return 1;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const fill = () => m[0].replace(/X/g, () => chars[(Math.floor(Math.random() * chars.length) + tmpCounter++) % chars.length]);
  const where = opts.values.get('p') ?? (opts.operands[0] && !opts.flags.has('t') ? '' : '/tmp');
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = template.slice(0, m.index) + fill() + template.slice(m.index + m[0].length);
    const shown = where ? `${where.replace(/\/+$/, '')}/${name}` : name;
    const p = abs(ctx, shown);
    if (ctx.fs.exists(p)) continue;
    try {
      if (!opts.flags.has('u')) {
        if (opts.flags.has('d')) {
          ctx.fs.mkdir(p);
          ctx.fs.chmod(p, 0o700);
        } else {
          ctx.fs.writeFile(p, '');
          ctx.fs.chmod(p, 0o600);
        }
      }
    } catch (e) {
      if (!opts.flags.has('q')) ctx.err(`mktemp: failed to create ${opts.flags.has('d') ? 'directory' : 'file'} via template ${lq(shown.replace(name, template))}: ${errorText((e as { code: 'ENOENT' }).code ?? 'ENOENT')}\n`);
      return 1;
    }
    ctx.out(shown + '\n');
    return 0;
  }
  return 1;
};

export const file: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'bLiz', long: { brief: 'b', 'mime-type': 'i' } });
  if (typeof opts === 'number') return opts;
  if (!opts.operands.length) {
    ctx.err('Usage: file [-bcCdEhikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding] [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>] [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet] <file> ...\n');
    return 1;
  }
  for (const a of opts.operands) {
    const p = abs(ctx, a);
    const st = ctx.fs.stat(p);
    let kind: string;
    let mime: string;
    if (!st) {
      kind = `cannot open \`${a}' (No such file or directory)`;
      mime = 'cannot open';
    } else if (st.type === 'dir') {
      kind = 'directory';
      mime = 'inode/directory';
    } else if (p.startsWith('/dev/')) {
      kind = 'character special';
      mime = 'inode/chardevice';
    } else {
      const t = ctx.fs.readFile(p);
      [kind, mime] = sniff(p, t);
    }
    ctx.out(`${opts.flags.has('b') ? '' : a + ': '}${opts.flags.has('i') ? mime : kind}\n`);
  }
  return 0;
};

function sniff(path: string, t: string): [string, string] {
  if (t === '') return ['empty', 'inode/x-empty'];
  if (t.startsWith('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;')) return ['SQLite 3.x database, last written using SQLite version 3046001', 'application/vnd.sqlite3'];
  if (t.startsWith('\x7fELF')) return ['ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped', 'application/x-pie-executable'];
  if (/^ÿØÿ/.test(t)) return ['JPEG image data, JFIF standard 1.01', 'image/jpeg'];
  if (t.startsWith('ftypheic')) return ['ISO Media, HEIF Image HEVC Main or Main Still Picture Profile', 'image/heic'];
  if (t.startsWith('%PDF-')) return [`PDF document, version ${t.slice(5, 8)}`, 'application/pdf'];
  if (t.startsWith('PK')) return [path.endsWith('.docx') ? 'Microsoft Word 2007+' : 'Zip archive data', 'application/zip'];
  if (t.startsWith('\x1f\x8b')) return ['gzip compressed data, from Unix', 'application/gzip'];
  if (t.startsWith('xar!')) return ['xar archive compressed TOC: 1', 'application/x-xar'];
  if (/ustar/.test(t.slice(257, 263))) return ['POSIX tar archive (GNU)', 'application/x-tar'];
  if (/^#!\s*\S*\b(ba)?sh\b/.test(t)) return ['Bourne-Again shell script, ASCII text executable', 'text/x-shellscript'];
  if (/^<\?php/.test(t)) return ['PHP script, ASCII text', 'text/x-php'];
  if (/^\s*[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return ['JSON text data', 'application/json'];
    } catch {
      /* not JSON */
    }
  }
  if (/^\s*<(!DOCTYPE html|html)/i.test(t)) return ['HTML document, ASCII text', 'text/html'];
  // eslint-disable-next-line no-control-regex
  const binary = /[\x00-\x08\x0e-\x1f]/.test(t.slice(0, 4096));
  if (binary) return ['data', 'application/octet-stream'];
  const ascii = !/[^\x00-\x7f]/.test(t);
  const lines = t.includes('\r\n') ? ', with CRLF line terminators' : '';
  return [`${ascii ? 'ASCII' : 'Unicode text, UTF-8'} text${lines}`.replace('UTF-8 text text', 'UTF-8 text'), 'text/plain'];
}

// ---- running other commands --------------------------------------------------------------

export const xargs: Command = (ctx) => {
  const args = ctx.args;
  let i = 0;
  let maxArgs = Infinity;
  let replace: string | null = null;
  let delim: string | null = null;
  let noRunEmpty = false;
  let trace = false;
  let maxLines = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (!a.startsWith('-') || a === '-') break;
    const val = (short: string) => (a.length > short.length ? a.slice(short.length) : args[++i]);
    if (a.startsWith('-n')) maxArgs = Number(val('-n'));
    else if (a.startsWith('-I')) replace = val('-I') ?? '{}';
    else if (a === '-i' || a.startsWith('--replace')) replace = '{}';
    else if (a.startsWith('-L')) maxLines = Number(val('-L'));
    else if (a === '-0' || a === '--null') delim = '\0';
    else if (a.startsWith('-d')) delim = (val('-d') ?? '\n').replace(/^\\n$/, '\n').replace(/^\\t$/, '\t');
    else if (a === '-r' || a === '--no-run-if-empty') noRunEmpty = true;
    else if (a === '-t' || a === '--verbose') trace = true;
    else if (a.startsWith('-P') || a.startsWith('-s')) val(a.slice(0, 2));
    else if (a === '-p' || a === '-x' || a === '-o') continue;
    else return usage(ctx, `invalid option -- '${a.slice(1, 2)}'`);
  }
  const cmd = args.slice(i).length ? args.slice(i) : ['echo'];
  let items: string[];
  if (delim !== null) items = ctx.stdin.split(delim).filter((s, k, arr) => !(k === arr.length - 1 && s === '') && (delim !== '\n' || s !== ''));
  else if (replace !== null || maxLines) items = lineTexts(ctx.stdin).map((l) => l.trim()).filter(Boolean);
  else {
    items = [];
    // Words, with quotes and backslashes as xargs reads them.
    const re = /"([^"]*)"|'([^']*)'|((?:\\.|[^\s"'])+)/g;
    for (const m of ctx.stdin.matchAll(re)) items.push(m[1] ?? m[2] ?? m[3].replace(/\\(.)/g, '$1'));
  }
  if (!items.length) {
    if (noRunEmpty || replace !== null) return 0;
    return run(cmd);
  }
  let status = 0;
  function run(argv: string[]): number {
    if (trace) ctx.err(argv.join(' ') + '\n');
    const s = ctx.run(argv, null);
    if (s === 127) {
      return 127;
    }
    return s === 0 ? 0 : 123;
  }
  if (replace !== null) {
    for (const item of items) {
      const r = run(cmd.map((c) => c.split(replace!).join(item)));
      if (r === 127) return 127;
      if (r) status = r;
    }
    return status;
  }
  const per = maxLines ? maxLines : maxArgs;
  for (let k = 0; k < items.length; k += per === Infinity ? items.length : per) {
    const r = run([...cmd, ...items.slice(k, per === Infinity ? undefined : k + per)]);
    if (r === 127) return 127;
    if (r) status = r;
  }
  return status;
};

export const printenv: Command = (ctx) => {
  const env = ctx.env();
  const names = ctx.args.filter((a) => !a.startsWith('-'));
  if (!names.length) {
    ctx.out(Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(''));
    return 0;
  }
  let status = 0;
  for (const n of names) {
    if (n in env) ctx.out(env[n] + '\n');
    else status = 1;
  }
  return status;
};

/** Duration like 5, 1.5, 2m, 1h. Null when invalid. */
function duration(s: string): number | null {
  const m = /^(\d+(?:\.\d*)?|\.\d+)([smhd]?)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]] * 1000;
}

export const sleep: Command = (ctx) => {
  if (!ctx.args.length) return usage(ctx, 'missing operand');
  let total = 0;
  for (const a of ctx.args) {
    if (a === 'infinity') {
      ctx.err('sleep: interrupted: sleeping forever is not something this terminal waits for\n');
      return 130;
    }
    const d = duration(a);
    if (d === null) return usage(ctx, `invalid time interval ${lq(a)}`);
    total += d;
  }
  // The terminal does not block: time moves forward instead.
  ctx.sleep(total);
  return 0;
};

export const timeout: Command = (ctx) => {
  const args = ctx.args.filter((a, i, all) => !(a.startsWith('-') && i < all.findIndex((x) => !x.startsWith('-'))));
  const [dur, ...cmd] = args;
  if (dur === undefined || duration(dur) === null) return usage(ctx, dur === undefined ? 'missing operand' : `invalid time interval ${lq(dur)}`, 125);
  if (!cmd.length) return usage(ctx, 'missing operand', 125);
  // Time here is the shell's clock, which only `sleep` moves: a command that slept past the limit timed out.
  const start = ctx.state.now();
  const status = ctx.run(cmd);
  return ctx.state.now() - start > duration(dur)! ? 124 : status;
};

export const nohup: Command = (ctx) => {
  if (!ctx.args.length) return usage(ctx, 'missing operand', 125);
  if (ctx.stdoutIsTty) {
    ctx.err("nohup: ignoring input and appending output to 'nohup.out'\n");
    const r = ctx.capture(ctx.args, null);
    try {
      ctx.fs.appendFile(abs(ctx, 'nohup.out'), r.stdout);
    } catch (e) {
      fail(ctx, `failed to open 'nohup.out': ${msgOf(e)}`);
      return 125;
    }
    return r.status;
  }
  return ctx.run(ctx.args);
};

export const ln: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'sfnvrTL', long: { symbolic: 's', force: 'f', verbose: 'v' } });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length === 0) return usage(ctx, 'missing file operand');
  const target = opts.operands[0];
  const link = opts.operands[1] ?? base(target);
  const st = statArg(ctx, target);
  if (!opts.flags.has('s') && typeof st === 'string') {
    fail(ctx, `failed to access ${q(target)}: ${errorText(st)}`);
    return 1;
  }
  fail(ctx, opts.flags.has('s') ? `failed to create symbolic link ${q(link)}: Operation not supported` : `failed to create hard link ${q(link)} => ${q(target)}: Operation not supported`);
  return 1;
};

export const less: Command = (ctx) => {
  const files = ctx.args.filter((a) => !a.startsWith('-') && !a.startsWith('+'));
  const all = inputs(ctx, files);
  if (!all) return 1;
  ctx.out(all.map((f) => f.text).join(''));
  return 0;
};

export const tput: Command = (ctx) => {
  const cap = ctx.args[0];
  const values: Record<string, string> = { cols: '80', lines: '24', colors: '256', longname: 'xterm with 256 colors' };
  if (cap === undefined) {
    ctx.err('usage: tput [-V] [-S] [-T term] capname\n');
    return 2;
  }
  if (cap in values) ctx.out(values[cap] + '\n');
  else if (cap === 'clear' || cap === 'reset') ctx.setAction({ type: 'clear' });
  return 0;
};

// ---- bc ----------------------------------------------------------------------------------

export const bc: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'lqsw', long: { mathlib: 'l', quiet: 'q' } });
  if (typeof opts === 'number') return opts;
  const vars = new Map<string, number>();
  let scale = opts.flags.has('l') ? 20 : 0;
  let source = ctx.stdin;
  for (const f of opts.operands) {
    const input = readInput(ctx, f);
    if (!input.ok) {
      ctx.err(`File ${f} is unavailable.\n`);
      continue;
    }
    source = input.text + '\n' + source;
  }
  const fmt = (v: number) => {
    let s = scale > 0 ? v.toFixed(Math.min(scale, 20)) : String(Math.trunc(v));
    if (scale > 0) s = s.replace(/^(-?)0\./, '$1.');
    return s;
  };
  let out = '';
  for (const raw of source.split(/[\n;]/)) {
    const line = raw.replace(/\/\*.*?\*\//g, '').replace(/#.*/, '').trim();
    if (!line || line === 'quit') {
      if (line === 'quit') break;
      continue;
    }
    ctx.tick();
    const toks: string[] = line.match(/\d+\.?\d*|\.\d+|[a-z_][a-z0-9_]*|\*\*|[-+*/%^()=<>!]=?|&&|\|\||\S/g) ?? [];
    let p = 0;
    const expr = (): number => cmpE();
    const cmpE = (): number => {
      let v = addE();
      while (['<', '>', '<=', '>=', '==', '!='].includes(toks[p])) {
        const op = toks[p++];
        const r = addE();
        v = Number(op === '<' ? v < r : op === '>' ? v > r : op === '<=' ? v <= r : op === '>=' ? v >= r : op === '==' ? v === r : v !== r);
      }
      return v;
    };
    const addE = (): number => {
      let v = mulE();
      while (toks[p] === '+' || toks[p] === '-') v = toks[p++] === '+' ? v + mulE() : v - mulE();
      return v;
    };
    const mulE = (): number => {
      let v = powE();
      while (toks[p] === '*' || toks[p] === '/' || toks[p] === '%') {
        const op = toks[p++];
        const r = powE();
        if (op !== '*' && r === 0) throw new Error('Runtime error (func=(main), adr=5): Divide by zero');
        if (op === '*') v *= r;
        else if (op === '/') v = scale ? v / r : Math.trunc(v / r);
        else v = v % r;
      }
      return v;
    };
    const powE = (): number => {
      const b = unary();
      if (toks[p] === '^') {
        p++;
        return Math.pow(b, Math.trunc(powE()));
      }
      return b;
    };
    const unary = (): number => {
      if (toks[p] === '-') {
        p++;
        return -unary();
      }
      if (toks[p] === '+') {
        p++;
        return unary();
      }
      return prim();
    };
    const fns: Record<string, (x: number) => number> = { sqrt: Math.sqrt, s: Math.sin, c: Math.cos, a: Math.atan, l: Math.log, e: Math.exp, length: (x) => String(Math.trunc(Math.abs(x))).length };
    const prim = (): number => {
      const t = toks[p++];
      if (t === undefined) throw new Error('syntax error');
      if (t === '(') {
        const v = expr();
        if (toks[p++] !== ')') throw new Error('syntax error');
        return v;
      }
      if (/^[\d.]/.test(t)) return Number(t);
      if (t === 'scale') return scale;
      if (fns[t] && toks[p] === '(') {
        p++;
        const v = expr();
        p++;
        return fns[t](v);
      }
      if (/^[a-z_]/.test(t)) return vars.get(t) ?? 0;
      throw new Error('syntax error');
    };
    try {
      if (toks[1] === '=' && /^[a-z_]/.test(toks[0])) {
        p = 2;
        const v = expr();
        if (toks[0] === 'scale') scale = Math.max(0, Math.trunc(v));
        else vars.set(toks[0], v);
        continue;
      }
      const v = expr();
      if (p < toks.length) throw new Error('syntax error');
      out += fmt(v) + '\n';
    } catch (e) {
      ctx.err(`(standard_in) 1: ${(e as Error).message}\n`);
    }
  }
  ctx.out(out);
  return 0;
};

