// tar, gzip, gunzip, zcat. The filesystem holds text, so archives are text too: tar writes real ustar
// headers (512-character blocks) around the files' text, and gzip keeps the gzip magic bytes followed by
// LZW-compressed data in base64. Both round-trip exactly; neither can be read by a real gzip or tar.

import type { Command, CommandContext } from './context.ts';
import { abs, modeString, msgOf, nameCompare, pad2, usage } from './context.ts';
import { readInput } from './text.ts';
import { errorText } from '../vfs.ts';
import { dirname, join } from '../path.ts';
import { globToRegex } from '../expand.ts';

// ---- compression -------------------------------------------------------------------------

/** What our gzip writes first: the real gzip magic, method and flags, then a marker for this format. */
const GZ_HEAD = '\x1f\x8b\x08\x00W755';
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

function fromBase64(s: string): Uint8Array | null {
  const clean = s.replace(/[\s=]/g, '');
  if (/[^A-Za-z0-9+/]/.test(clean)) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A');
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const MAX_BITS = 16;

/** LZW over bytes with codes growing from 9 to 16 bits and a reset when the table fills, like compress(1). */
function lzw(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let accBits = 0;
  let width = 9;
  const emit = (code: number) => {
    acc |= code << accBits;
    accBits += width;
    while (accBits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      accBits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = 257; // 256 is the reset code
  let w = -1;
  for (const b of input) {
    if (w < 0) {
      w = b;
      continue;
    }
    const key = w * 256 + b;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
      continue;
    }
    emit(w);
    if (next < 1 << MAX_BITS) {
      dict.set(key, next++);
      if (next > 1 << width && width < MAX_BITS) width++;
    } else {
      emit(256);
      dict = new Map();
      next = 257;
      width = 9;
    }
    w = b;
  }
  if (w >= 0) emit(w);
  if (accBits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

function unlzw(input: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  let acc = 0;
  let accBits = 0;
  let width = 9;
  let pos = 0;
  const read = (): number | null => {
    while (accBits < width) {
      if (pos >= input.length) return null;
      acc |= input[pos++] << accBits;
      accBits += 8;
    }
    const code = acc & ((1 << width) - 1);
    acc >>>= width;
    accBits -= width;
    return code;
  };
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table.push([i]);
    table.push([]);
    width = 9;
  };
  reset();
  let prev: number[] | null = null;
  for (;;) {
    // The encoder widens one code later than the table grows here, so look one entry ahead.
    if (prev !== null && table.length + 1 > 1 << width && width < MAX_BITS) width++;
    const code = read();
    if (code === null) break;
    if (code === 256) {
      reset();
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else return null;
    for (const b of entry) out.push(b);
    if (out.length > 8_000_000) return null;
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
  }
  return Uint8Array.from(out);
}

export function gzipText(text: string): string {
  return GZ_HEAD + toBase64(lzw(enc.encode(text))) + '\n';
}

/** The text inside our gzip data, or null when it is not gzip data we wrote. */
export function gunzipText(data: string): string | null {
  if (!data.startsWith(GZ_HEAD)) return null;
  const bytes = fromBase64(data.slice(GZ_HEAD.length));
  if (!bytes) return null;
  const raw = unlzw(bytes);
  return raw ? dec.decode(raw) : null;
}

// ---- gzip, gunzip, zcat ------------------------------------------------------------------

const GZIP_HELP = `Usage: gzip [OPTION]... [FILE]...
Compress or uncompress FILEs (by default, compress FILES in-place).

  -c, --stdout      write on standard output, keep original files unchanged
  -d, --decompress  decompress
  -f, --force       force overwrite of output file
  -k, --keep        keep (don't delete) input files
  -l, --list        list compressed file contents
  -t, --test        test compressed file integrity
  -v, --verbose     verbose mode
  -1 .. -9          compress faster or better (no difference here)

With no FILE, or when FILE is -, read standard input.
`;

function gzipMain(ctx: CommandContext, mode: 'gzip' | 'gunzip' | 'zcat'): number {
  let decompress = mode !== 'gzip';
  let toStdout = mode === 'zcat';
  let keep = false;
  let force = false;
  let verbose = false;
  let list = false;
  let test = false;
  const files: string[] = [];
  const LONG: Record<string, string> = { stdout: 'c', 'to-stdout': 'c', decompress: 'd', uncompress: 'd', force: 'f', keep: 'k', list: 'l', test: 't', verbose: 'v', quiet: 'q', best: '9', fast: '1' };
  let ended = false;
  for (const a of ctx.args) {
    if (ended || a === '-' || !a.startsWith('-')) {
      files.push(a);
      continue;
    }
    if (a === '--') {
      ended = true;
      continue;
    }
    let letters: string;
    if (a.startsWith('--')) {
      if (a === '--help') {
        ctx.out(GZIP_HELP);
        return 0;
      }
      if (a === '--version') {
        ctx.out('gzip 1.12\n');
        return 0;
      }
      const l = LONG[a.slice(2)];
      if (!l) return usage(ctx, `unrecognized option '${a}'`);
      letters = l;
    } else letters = a.slice(1);
    for (const ch of letters) {
      if (ch === 'c') toStdout = true;
      else if (ch === 'd') decompress = true;
      else if (ch === 'k') keep = true;
      else if (ch === 'f') force = true;
      else if (ch === 'v') verbose = true;
      else if (ch === 'l') list = true;
      else if (ch === 't') test = true;
      else if (ch === 'q' || ch === 'n' || ch === 'N' || /\d/.test(ch)) continue;
      else return usage(ctx, `invalid option -- '${ch}'`);
    }
  }
  if (list) decompress = true;
  const name = ctx.name;
  let status = 0;
  if (!files.length) files.push('-');
  if (list) ctx.out('         compressed        uncompressed  ratio uncompressed_name\n');
  for (const f of files) {
    ctx.tick();
    if (f === '-') {
      if (!decompress && ctx.stdoutIsTty && !force) {
        ctx.err(`${name}: compressed data not written to a terminal. Use -f to force compression.\nFor help, type: ${name} -h\n`);
        return 1;
      }
      const out = decompress ? gunzipText(ctx.stdin) : gzipText(ctx.stdin);
      if (out === null) {
        ctx.err(`${name}: stdin: not in gzip format\n`);
        status = 1;
        continue;
      }
      ctx.out(out);
      continue;
    }
    const input = readInput(ctx, f);
    const path = abs(ctx, f);
    if (!input.ok) {
      ctx.err(`${name}: ${f}: ${errorText(input.code)}\n`);
      status = 1;
      continue;
    }
    if (ctx.fs.stat(path)?.type === 'dir') {
      ctx.err(`${name}: ${f} is a directory -- ignored\n`);
      status = 2;
      continue;
    }
    if (decompress) {
      if (!toStdout && !list && !test && !/\.(gz|tgz|z)$/i.test(f)) {
        ctx.err(`${name}: ${f}: unknown suffix -- ignored\n`);
        status = 2;
        continue;
      }
      const text = gunzipText(input.text);
      if (text === null) {
        ctx.err(`${name}: ${f}: not in gzip format\n`);
        status = 1;
        continue;
      }
      if (test) continue;
      const target = f.replace(/\.tgz$/i, '.tar').replace(/\.(gz|z)$/i, '');
      if (list) {
        ctx.out(`${String(input.text.length).padStart(19)} ${String(text.length).padStart(19)} ${ratio(input.text.length, text.length).padStart(5)} ${target}\n`);
        continue;
      }
      if (toStdout) {
        ctx.out(text);
        continue;
      }
      if (!write(ctx, name, abs(ctx, target), target, text, force, path, keep)) {
        status = 1;
        continue;
      }
      if (verbose) ctx.err(`${f}:\t${ratio(input.text.length, text.length)} -- replaced with ${target}\n`);
    } else {
      if (/\.(gz|tgz)$/i.test(f) && !force && !toStdout) {
        ctx.err(`${name}: ${f} already has .gz suffix -- unchanged\n`);
        status = 2;
        continue;
      }
      const data = gzipText(input.text);
      if (toStdout) {
        ctx.out(data);
        continue;
      }
      if (!write(ctx, name, path + '.gz', f + '.gz', data, force, path, keep)) {
        status = 1;
        continue;
      }
      if (verbose) ctx.err(`${f}:\t${ratio(data.length, input.text.length)} -- replaced with ${f}.gz\n`);
    }
  }
  return status;
}

function ratio(compressed: number, plain: number): string {
  if (plain === 0) return '0.0%';
  return `${(((plain - compressed) / plain) * 100).toFixed(1)}%`;
}

/** Writes the result next to the input and removes the input unless kept. */
function write(ctx: CommandContext, name: string, path: string, shown: string, text: string, force: boolean, input: string, keep: boolean): boolean {
  if (ctx.fs.stat(path) && !force) {
    ctx.err(`${name}: ${shown} already exists; not overwritten\n`);
    return false;
  }
  try {
    ctx.fs.writeFile(path, text);
    const mode = ctx.fs.stat(input)?.mode;
    if (mode !== undefined) ctx.fs.chmod(path, mode);
    if (!keep) ctx.fs.remove(input);
    return true;
  } catch (e) {
    ctx.err(`${name}: ${shown}: ${msgOf(e)}\n`);
    return false;
  }
}

export const gzip: Command = (ctx) => gzipMain(ctx, 'gzip');
export const gunzip: Command = (ctx) => gzipMain(ctx, 'gunzip');
export const zcat: Command = (ctx) => gzipMain(ctx, 'zcat');

// ---- tar ---------------------------------------------------------------------------------

interface Member {
  name: string;
  type: 'file' | 'dir';
  mode: number;
  mtime: number;
  content: string;
}

const BLOCK = 512;

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function field(s: string, width: number): string {
  return s.slice(0, width).padEnd(width, '\0');
}

function header(m: Member, user: string): string {
  let h =
    field(m.name, 100) + octal(m.mode & 0o7777, 8) + octal(1000, 8) + octal(1000, 8) +
    octal(m.type === 'dir' ? 0 : m.content.length, 12) + octal(Math.floor(m.mtime / 1000), 12) + '        ' +
    (m.type === 'dir' ? '5' : '0') + field('', 100) + 'ustar  \0' + field(user, 32) + field(user, 32);
  h = h.padEnd(BLOCK, '\0');
  let sum = 0;
  for (let i = 0; i < h.length; i++) sum += h.charCodeAt(i) & 255;
  return h.slice(0, 148) + sum.toString(8).padStart(6, '0') + '\0 ' + h.slice(156);
}

function packTar(members: Member[], user: string): string {
  let out = '';
  for (const m of members) {
    out += header(m, user);
    if (m.type === 'file' && m.content.length) {
      out += m.content + '\0'.repeat((BLOCK - (m.content.length % BLOCK)) % BLOCK);
    }
  }
  return out + '\0'.repeat(BLOCK * 2);
}

function unpackTar(data: string): Member[] | null {
  const out: Member[] = [];
  if (data.length > 0 && data.length < BLOCK) return null;
  let pos = 0;
  while (pos + BLOCK <= data.length) {
    const h = data.slice(pos, pos + BLOCK);
    if (/^\0*$/.test(h)) break;
    if (!h.slice(257, 262).startsWith('ustar')) return null;
    const name = h.slice(0, 100).replace(/\0.*$/s, '');
    const mode = parseInt(h.slice(100, 108), 8) || 0o644;
    const size = parseInt(h.slice(124, 136), 8) || 0;
    const mtime = (parseInt(h.slice(136, 148), 8) || 0) * 1000;
    const type = h[156] === '5' ? 'dir' : 'file';
    pos += BLOCK;
    const content = type === 'file' ? data.slice(pos, pos + size) : '';
    if (content.length < size) return null;
    pos += Math.ceil(size / BLOCK) * BLOCK;
    out.push({ name, type, mode, mtime, content });
  }
  return out;
}

const TAR_HELP = `Usage: tar [OPTION...] [FILE]...
GNU 'tar' saves many files together into a single tape or disk archive, and can
restore individual files from the archive.

Examples:
  tar -cf archive.tar foo bar  # Create archive.tar from files foo and bar.
  tar -tvf archive.tar         # List all files in archive.tar verbosely.
  tar -xf archive.tar          # Extract all files from archive.tar.

  -c, --create               create a new archive
  -t, --list                 list the contents of an archive
  -x, --extract, --get       extract files from an archive
  -f, --file=ARCHIVE         use archive file ARCHIVE
  -z, --gzip                 filter the archive through gzip
  -v, --verbose              verbosely list files processed
  -C, --directory=DIR        change to directory DIR
  -O, --to-stdout            extract files to standard output
      --exclude=PATTERN      exclude files matching PATTERN
`;

function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const tar: Command = (ctx) => {
  let op: 'c' | 'x' | 't' | null = null;
  let file: string | null = null;
  let gz = false;
  let verbose = false;
  let toStdout = false;
  let dir: string | null = null;
  const excludes: RegExp[] = [];
  const operands: string[] = [];
  const args = [...ctx.args];
  // Old-style first argument: `tar czf a.tgz dir`.
  if (args[0] && !args[0].startsWith('-') && /^[ctxzvfjJOC]+$/.test(args[0])) args[0] = '-' + args[0];
  const setOp = (o: 'c' | 'x' | 't'): boolean => {
    if (op && op !== o) {
      ctx.err("tar: You may not specify more than one '-Acdtrux', '--delete' or  '--test-label' option\nTry 'tar --help' or 'tar --usage' for more information.\n");
      return false;
    }
    op = o;
    return true;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      const value = () => inline ?? args[++i];
      switch (name) {
        case 'help': ctx.out(TAR_HELP); return 0;
        case 'version': ctx.out('tar (GNU tar) 1.35\n'); return 0;
        case 'create': if (!setOp('c')) return 2; break;
        case 'extract': case 'get': if (!setOp('x')) return 2; break;
        case 'list': if (!setOp('t')) return 2; break;
        case 'file': file = value() ?? null; break;
        case 'gzip': case 'gunzip': case 'ungzip': gz = true; break;
        case 'verbose': verbose = true; break;
        case 'to-stdout': toStdout = true; break;
        case 'directory': dir = value() ?? null; break;
        case 'exclude': {
          const v = value();
          if (v) excludes.push(globToRegex(v));
          break;
        }
        default:
          ctx.err(`tar: unrecognized option '${a}'\nTry 'tar --help' or 'tar --usage' for more information.\n`);
          return 2;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (ch === 'c' || ch === 'x' || ch === 't') {
          if (!setOp(ch)) return 2;
        } else if (ch === 'z') gz = true;
        else if (ch === 'v') verbose = true;
        else if (ch === 'O') toStdout = true;
        else if (ch === 'j' || ch === 'J') {
          ctx.err(`tar: ${ch === 'j' ? 'bzip2' : 'xz'}: Cannot exec: No such file or directory\ntar: Error is not recoverable: exiting now\n`);
          return 2;
        } else if (ch === 'f' || ch === 'C') {
          const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (v === undefined) {
            ctx.err(`tar: option requires an argument -- '${ch}'\nTry 'tar --help' or 'tar --usage' for more information.\n`);
            return 2;
          }
          if (ch === 'f') file = v;
          else dir = v;
          break;
        } else if ('pPhkmwSo'.includes(ch)) continue;
        else {
          ctx.err(`tar: invalid option -- '${ch}'\nTry 'tar --help' or 'tar --usage' for more information.\n`);
          return 2;
        }
      }
      continue;
    }
    operands.push(a);
  }
  if (!op) {
    ctx.err("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.\n");
    return 2;
  }
  const base = dir ? abs(ctx, dir) : ctx.state.cwd;
  if (dir && ctx.fs.stat(base)?.type !== 'dir') {
    ctx.err(`tar: ${dir}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }
  const excluded = (name: string) => excludes.some((re) => re.test(name) || re.test(name.slice(name.lastIndexOf('/') + 1)));

  if (op === 'c') {
    if (!operands.length) {
      ctx.err('tar: Cowardly refusing to create an empty archive\nTry \'tar --help\' or \'tar --usage\' for more information.\n');
      return 2;
    }
    if (!file && ctx.stdoutIsTty) {
      ctx.err('tar: Refusing to write archive contents to terminal (missing -f option?)\ntar: Error is not recoverable: exiting now\n');
      return 2;
    }
    const members: Member[] = [];
    let status = 0;
    let warnedSlash = false;
    let bytes = 0;
    const archivePath = file && file !== '-' ? abs(ctx, file) : null;
    const add = (path: string, name: string): void => {
      ctx.tick();
      if (excluded(name)) return;
      if (path === archivePath) {
        ctx.err(`tar: ${name}: file is the archive; not dumped\n`);
        return;
      }
      const st = ctx.fs.stat(path)!;
      if (ctx.fs.isSystem(path) && st.type === 'dir') {
        ctx.err(`tar: ${name}: Cannot open: Permission denied\n`);
        status = 2;
        return;
      }
      if (st.type === 'dir') {
        members.push({ name: name.replace(/\/*$/, '/'), type: 'dir', mode: st.mode, mtime: st.mtime, content: '' });
        if (verbose) ctx.err(name.replace(/\/*$/, '/') + '\n');
        const kids = ctx.fs.list(path).map((c) => c.path.slice(c.path.lastIndexOf('/') + 1)).sort(nameCompare);
        for (const k of kids) add(join(path, k), name.replace(/\/*$/, '') + '/' + k);
        return;
      }
      const content = ctx.fs.readFile(path);
      bytes += content.length;
      if (bytes > 4_000_000) throw new Error('too big');
      members.push({ name, type: 'file', mode: st.mode, mtime: st.mtime, content });
      if (verbose) ctx.err(name + '\n');
    };
    try {
      for (const o of operands) {
        const path = o.startsWith('/') ? o : join(base, o);
        const st = ctx.fs.stat(path);
        if (!st) {
          ctx.err(`tar: ${o}: Cannot stat: No such file or directory\n`);
          status = 2;
          continue;
        }
        let name = o.replace(/^\.\/+/, '') || '.';
        if (name.startsWith('/')) {
          if (!warnedSlash) ctx.err("tar: Removing leading `/' from member names\n");
          warnedSlash = true;
          name = name.replace(/^\/+/, '') || '.';
        }
        add(path, name);
      }
    } catch {
      ctx.err('tar: archive too large\ntar: Error is not recoverable: exiting now\n');
      return 2;
    }
    let data = packTar(members, ctx.state.user);
    if (gz) data = gzipText(data);
    if (!file || file === '-') ctx.out(data);
    else {
      try {
        ctx.fs.writeFile(abs(ctx, file), data);
      } catch (e) {
        ctx.err(`tar: ${file}: Cannot open: ${msgOf(e)}\ntar: Error is not recoverable: exiting now\n`);
        return 2;
      }
    }
    if (status) ctx.err('tar: Exiting with failure status due to previous errors\n');
    return status;
  }

  // List or extract.
  let data: string;
  if (!file || file === '-') data = ctx.stdin;
  else {
    const input = readInput(ctx, file);
    if (!input.ok) {
      ctx.err(`tar: ${file}: Cannot open: ${errorText(input.code)}\ntar: Error is not recoverable: exiting now\n`);
      return 2;
    }
    data = input.text;
  }
  if (data.startsWith('\x1f\x8b')) {
    // GNU tar notices compression by itself.
    const plain = gunzipText(data);
    if (plain === null) {
      ctx.err('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n');
      return 2;
    }
    data = plain;
  } else if (gz) {
    ctx.err('\ngzip: stdin: not in gzip format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now\n');
    return 2;
  }
  const members = unpackTar(data);
  if (!members) {
    ctx.err('tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n');
    return 2;
  }
  const wanted = operands.map((o) => o.replace(/\/+$/, ''));
  const found = new Set<string>();
  const selected = members.filter((m) => {
    const n = m.name.replace(/\/+$/, '');
    if (excluded(n)) return false;
    if (!wanted.length) return true;
    const w = wanted.find((x) => n === x || n.startsWith(x + '/'));
    if (w) found.add(w);
    return !!w;
  });
  let status = 0;
  for (const m of selected) {
    ctx.tick();
    if (op === 't') {
      if (verbose) {
        const size = String(m.type === 'dir' ? 0 : m.content.length);
        ctx.out(`${modeString(m.type, m.mode)} ${ctx.state.user}/${ctx.state.user} ${size.padStart(Math.max(6, size.length))} ${stamp(m.mtime)} ${m.name}\n`);
      } else ctx.out(m.name + '\n');
      continue;
    }
    if (toStdout) {
      if (m.type === 'file') ctx.out(m.content);
      continue;
    }
    if (verbose) ctx.out(m.name + '\n');
    const rel = m.name.replace(/^\/+/, '').replace(/\/+$/, '');
    if (rel.split('/').includes('..')) {
      ctx.err(`tar: ${m.name}: Member name contains '..'\n`);
      status = 2;
      continue;
    }
    const path = rel === '.' || rel === '' ? base : join(base, rel);
    try {
      if (m.type === 'dir') {
        if (ctx.fs.stat(path)?.type !== 'dir') ctx.fs.mkdir(path, { recursive: true });
      } else {
        if (ctx.fs.stat(dirname(path))?.type !== 'dir') ctx.fs.mkdir(dirname(path), { recursive: true });
        if (ctx.fs.stat(path)?.type === 'dir') {
          ctx.err(`tar: ${m.name}: Cannot open: Is a directory\n`);
          status = 2;
          continue;
        }
        ctx.fs.writeFile(path, m.content);
      }
      ctx.fs.chmod(path, m.mode);
      ctx.fs.setMeta(path, m.mode, m.mtime);
    } catch (e) {
      ctx.err(`tar: ${m.name}: Cannot open: ${msgOf(e)}\n`);
      status = 2;
    }
  }
  for (const w of wanted) {
    if (!found.has(w)) {
      ctx.err(`tar: ${w}: Not found in archive\n`);
      status = 2;
    }
  }
  if (status) ctx.err('tar: Exiting with failure status due to previous errors\n');
  return status;
};
