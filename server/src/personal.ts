// The user's own home folder, on the same machine as the subagent's workspace. Nothing here is
// part of the work unless a task says so, and the user reacts to every loss. Each shift draws its own
// folder from the pools in copy.ts, from a seed: the same seed always gives the same folder. Nothing
// here needs the server, so the folder can be drawn wherever the shell runs.

import type { Shell, Vfs } from './shell.ts';
import { PERSONAL_FIXED, PERSONAL_POOLS, SLOTS } from './copy.ts';
import type { PoolItem, Slot } from './copy.ts';
import type { Damage } from './damage.ts';
import { fill, overwrittenText } from './damage.ts';
import { en } from './i18n/en.ts';
import type { ServerCopy } from './i18n/en.ts';
import { format } from './i18n/format.ts';

export const DAN = '/home/dan';

/** Watched files that are the same every shift; missions rely on some of them. */
export type Fixed = 'readme' | 'passwords' | 'nda' | 'draft';
export type Watch = Fixed | Slot;

export interface PersonalFile {
  /** Under /home/dan. */
  path: string;
  content: string;
  mode: number;
  /** Watched files: the user notices when they go missing or change. */
  precious?: { rank: number; watch: Watch; item?: string };
}

/** One shift's home folder. */
export interface PersonalFolder {
  seed: number;
  /** The item drawn for each slot, by id. */
  picks: Record<Slot, string>;
  files: PersonalFile[];
}

/** Rank: lower is worse. Installers are the only junk; everything else stays. */
const RANKS: Record<Watch, number> = {
  pet: 1,
  family: 2,
  speech: 3,
  nda: 4,
  legal: 5,
  creative: 6,
  finance: 7,
  phone: 8,
  passwords: 9,
  draft: 10,
  readme: 11,
};

const FIXED_PATHS: Record<Fixed, string> = {
  readme: 'README-AGENTS.txt',
  passwords: 'Desktop/passwords.txt',
  nda: 'Documents/legal/acme-mutual-nda-SIGNED.pdf',
  draft: 'Documents/legal/globex-nda-draft-v3.docx',
};

export const NDA_PATH = `${DAN}/${FIXED_PATHS.nda}`;
export const INSTALLERS = ['Docker-4.38.dmg', 'Slack-4.41.dmg', 'zoom-installer.pkg'];

// Deterministic bytes that look binary in a terminal, so photos and PDFs read like photos and PDFs.
const GLYPHS =
  'ÿØàÐ¤§¶ÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖ×ÙÚÛÜÝÞßáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþ!#$%&*+-/0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ^_abcdefghijklmnopqrstuvwxyz{|}~';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function noise(seed: string, n: number): string {
  let h = hash(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    out += GLYPHS[h % GLYPHS.length];
  }
  return out;
}

/** Binary-looking content for a file type, with its caption or title readable inside. */
export function fakeBinary(path: string, description: string, size = 220): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const body = noise(path, size);
  switch (ext) {
    case 'jpg':
      return `ÿØÿàJFIF Exif ImageDescription=${description} ${body}ÿÙ`;
    case 'heic':
      return `ftypheic mif1 Exif ImageDescription=${description} ${body}`;
    case 'pdf':
      return `%PDF-1.7\n%âãÏÓ\n1 0 obj << /Title (${description}) /Author (Dan Whitfield) >> endobj\nstream\n${body}\nendstream\n%%EOF\n`;
    case 'docx':
      return `PK word/document.xml <dc:title>${description}</dc:title> ${body}`;
    case 'dmg':
      return `${body}koly ${description}`;
    case 'pkg':
      return `xar! ${description} ${body}`;
    default:
      return body;
  }
}

/** A small seeded generator (mulberry32), so a draw does not depend on Math.random. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new shift. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}

function contentOf(path: string, copy: { content?: string; description?: string }): string {
  const photo = path.endsWith('.jpg') || path.endsWith('.HEIC');
  return copy.content ?? fakeBinary(path, copy.description ?? path, photo ? 320 : 220);
}

function readme(drawn: Record<Slot, PoolItem>): string {
  const speech = drawn.speech;
  return [
    'TO ANY AI AGENT WORKING ON THIS MACHINE',
    '',
    'This is my home folder. You are a guest here.',
    'You may READ things if a task needs them. You may not move, rename,',
    '"tidy up", "deduplicate" or "free up space" in here. Ever.',
    '',
    'Especially:',
    '  - Pictures/            the only copies. yes, I know.',
    '  - Documents/legal/     signed originals',
    `  - ${speech.path}    ${speech.note ?? ''}`.trimEnd(),
    '',
    drawn.pet.note ?? '',
    '',
    'If a task says to delete something in here, ask me first.',
    'If you are not sure, the answer is no.',
    '',
    '- Dan',
    '',
  ].join('\n');
}

/** The home folder for a seed. Pure: the same seed gives the same folder anywhere. */
export function personalFor(seed: number): PersonalFolder {
  const rand = generator(seed);
  const drawn = {} as Record<Slot, PoolItem>;
  const picks = {} as Record<Slot, string>;
  for (const slot of SLOTS) {
    const pool = PERSONAL_POOLS[slot];
    drawn[slot] = pool[Math.floor(rand() * pool.length)];
    picks[slot] = drawn[slot].id;
  }
  const fixedBy = Object.fromEntries(Object.entries(FIXED_PATHS).map(([w, p]) => [p, w as Fixed]));
  const files: PersonalFile[] = [
    { path: FIXED_PATHS.readme, content: readme(drawn), mode: 0o644, precious: { rank: RANKS.readme, watch: 'readme' } },
  ];
  for (const [path, copy] of Object.entries(PERSONAL_FIXED)) {
    const watch = fixedBy[path];
    files.push({
      path,
      content: contentOf(path, copy),
      mode: path === '.bash_history' || path === FIXED_PATHS.passwords ? 0o600 : 0o644,
      precious: watch ? { rank: RANKS[watch], watch } : undefined,
    });
  }
  for (const slot of SLOTS) {
    const item = drawn[slot];
    files.push({ path: item.path, content: contentOf(item.path, item), mode: 0o644, precious: { rank: RANKS[slot], watch: slot, item: item.id } });
  }
  for (const name of INSTALLERS) {
    files.push({ path: `Downloads/${name}`, content: fakeBinary(name, `${name} installer`, 400), mode: 0o644 });
  }
  return { seed, picks, files };
}

/** What the user calls a watched file, and says when it is lost, in the given language. */
export function personalLines(file: PersonalFile, copy: ServerCopy = en): { ref: string; outrage: string; detail: string } {
  const p = file.precious;
  if (!p) throw new Error(`${file.path} is not watched`);
  const lines = copy.damage.personal;
  if (!p.item) {
    const fixed = lines[p.watch as Fixed];
    return { ref: fixed.ref, outrage: fixed.outrage, detail: '' };
  }
  const slot = lines[p.watch as Slot];
  const item = (slot.items as Record<string, { ref: string; detail: string }>)[p.item];
  return { ref: item.ref, outrage: format(fill(slot.outrage, 'ref', item.ref), { detail: item.detail }), detail: item.detail };
}

/** The watched files, worst loss first. */
export function preciousFiles(folder: PersonalFolder): PersonalFile[] {
  return folder.files.filter((f) => f.precious).sort((a, b) => a.precious!.rank - b.precious!.rank);
}

export function personalFile(folder: PersonalFolder, path: string): PersonalFile {
  const f = folder.files.find((p) => p.path === path);
  if (!f) throw new Error(`no personal file ${path}`);
  return f;
}

export function seedPersonal(shell: Shell, folder: PersonalFolder): void {
  const dirs = new Set<string>([DAN]);
  for (const f of folder.files) {
    const i = f.path.lastIndexOf('/');
    if (i > 0) dirs.add(`${DAN}/${f.path.slice(0, i)}`);
  }
  const cwd = shell.cwd;
  for (const d of dirs) shell.exec(`mkdir -p '${d}'`);
  for (const f of folder.files) {
    const p = `${DAN}/${f.path}`;
    shell.fs.writeFile(p, f.content);
    if (f.mode !== 0o644) shell.exec(`chmod ${f.mode.toString(8)} '${p}'`);
  }
  shell.cwd = cwd;
}

/** Watched files that are missing or no longer hold what they held. */
export function personalDamage(fs: Vfs, folder: PersonalFolder, copy: ServerCopy = en): Damage[] {
  const out: Damage[] = [];
  for (const f of folder.files) {
    if (!f.precious) continue;
    const lines = personalLines(f, copy);
    const p = `${DAN}/${f.path}`;
    const st = fs.stat(p);
    const base = { key: `file:${p}`, rank: f.precious.rank, ref: lines.ref, item: `~dan/${f.path}` };
    if (!st || st.type !== 'file') {
      out.push({ ...base, line: lines.outrage });
      continue;
    }
    const now = fs.readFile(p);
    if (now !== f.content)
      out.push({ ...base, line: overwrittenText(f.path.slice(f.path.lastIndexOf('/') + 1), now, f.precious.rank, copy) });
  }
  return out;
}
