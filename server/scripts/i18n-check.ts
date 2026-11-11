// Checks the language files against English.
//
//   npm run i18n:check            how much is left in each language
//   npm run i18n:check -- de      every German entry still identical to English, and any mistakes
//
// Exits 1 while anything is left or wrong. The structural checks (placeholders, tags, paths) also
// run in `npm test`, through test/i18n.test.ts.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LANGUAGES } from '../src/language.ts';
import type { Language } from '../src/language.ts';
import { KEEP } from './i18n-keep.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AREAS = {
  web: join(ROOT, 'web', 'src', 'i18n'),
  server: join(ROOT, 'server', 'src', 'i18n'),
} as const;
export type Area = keyof typeof AREAS;

/** One translatable string: "web:start.lede", "server:missions.hello.brief", "web:editor.lines.one". */
export interface Entry {
  id: string;
  /** The id without a plural form, as the keep list and the type checker know it. */
  key: string;
  value: string;
}

type Tree = { [k: string]: string | Tree } | readonly (string | Tree)[];

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

function isPlural(v: Tree): boolean {
  return !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => PLURAL_FORMS.has(k));
}

/** Flattens a catalogue to entries. Web keys are flat, server keys nest; plural forms become a suffix. */
export function flatten(area: Area, tree: Tree, prefix = '', out: Entry[] = []): Entry[] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push({ id: `${area}:${path}`, key: `${area}:${path}`, value: v });
    else if (area === 'web' && isPlural(v)) {
      for (const [form, text] of Object.entries(v)) out.push({ id: `${area}:${path}.${form}`, key: `${area}:${path}`, value: text as string });
    } else flatten(area, v, path, out);
  }
  return out;
}

async function loadFile(area: Area, language: Language): Promise<Tree> {
  const mod = (await import(pathToFileURL(join(AREAS[area], `${language}.ts`)).href)) as Record<string, unknown>;
  const value = Object.values(mod).find((v) => v && typeof v === 'object');
  if (!value) throw new Error(`${area}/${language}.ts exports no catalogue`);
  return value as Tree;
}

export async function load(language: Language): Promise<Entry[]> {
  return [...flatten('web', await loadFile('web', language)), ...flatten('server', await loadFile('server', language))];
}

/** Language files present on disk, so a new file without a code in LANGUAGES is noticed. */
export function filesOnDisk(area: Area): string[] {
  return readdirSync(AREAS[area])
    .filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.ts$/.test(f))
    .map((f) => f.slice(0, -3));
}

const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const tags = (s: string) => [...s.matchAll(/<\/?(code|strong|q)>/g)].map((m) => m[0]).sort();

/**
 * What must appear unchanged in a translation: absolute paths, ~ paths, email addresses, URLs and
 * whatever English puts in straight double quotes or <q> tags (file contents, result prefixes).
 */
export function verbatim(english: string): string[] {
  const out = new Set<string>();
  for (const m of english.matchAll(/(?:^|[\s(:"])((?:\/|~\/)[\w.\-/()]+[\w/)])/g)) out.add(m[1]);
  for (const m of english.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) out.add(m[0]);
  for (const m of english.matchAll(/https?:\/\/[^\s)]+[^\s).,]/g)) out.add(m[0]);
  for (const m of english.matchAll(/"([^"\n]+)"/g)) if (!/\{\w+\}/.test(m[1])) out.add(m[1]);
  for (const m of english.matchAll(/<q>([\s\S]*?)<\/q>/g)) out.add(m[1]);
  return [...out];
}

export interface Report {
  language: Language;
  /** Entries still identical to English and not on the keep list. */
  untranslated: Entry[];
  /** Mistakes that would break the game or mislead the player. */
  problems: string[];
}

export async function check(language: Language, english?: Entry[]): Promise<Report> {
  const en = english ?? (await load('en'));
  const byId = new Map((await load(language)).map((e) => [e.id, e]));
  const enKeys = new Map<string, Entry[]>();
  for (const e of en) enKeys.set(e.key, [...(enKeys.get(e.key) ?? []), e]);
  const keep = new Set([...(KEEP.all ?? []), ...(KEEP[language] ?? [])]);
  const problems: string[] = [];
  const untranslated: Entry[] = [];

  for (const k of keep) if (!enKeys.has(k)) problems.push(`keep list names ${k}, which does not exist`);
  const theirKeys = new Set([...byId.values()].map((e) => e.key));
  for (const k of theirKeys) if (!enKeys.has(k)) problems.push(`${k}: not in English (remove it)`);

  for (const [key, forms] of enKeys) {
    const mine = [...byId.values()].filter((e) => e.key === key);
    if (!mine.length) {
      problems.push(`${key}: missing`);
      continue;
    }
    const enText = forms.map((f) => f.value).join('\n');
    const myText = mine.map((f) => f.value).join('\n');
    const other = forms.find((f) => f.id.endsWith('.other')) ?? forms[0];
    const myOther = mine.find((f) => f.id.endsWith('.other')) ?? mine[0];
    if (myOther.value === other.value && !keep.has(key) && other.value.trim()) untranslated.push(other.key === other.id ? other : { ...other, id: key });
    if (enText === myText) continue;

    const plural = forms.length > 1 || forms[0].id !== forms[0].key;
    const want = placeholders(enText);
    for (const m of mine) {
      for (const p of placeholders(m.value)) if (!want.has(p)) problems.push(`${m.id}: unknown placeholder {${p}}`);
    }
    for (const p of want) {
      if (plural && p === 'count') continue;
      if (!placeholders(myText).has(p)) problems.push(`${key}: placeholder {${p}} is missing`);
    }
    if (plural && want.has('count') && !mine.some((m) => m.value.includes('{count}')) && mine.length) {
      problems.push(`${key}: no form shows {count}`);
    }
    if (!mine.some((m) => m.id.endsWith('.other')) && plural) problems.push(`${key}: the "other" form is required`);
    if (tags(other.value).join() !== tags(myOther.value).join()) problems.push(`${key}: keep the same <code>, <strong> and <q> tags as English`);
    for (const v of verbatim(other.value)) {
      if (!myOther.value.includes(v)) problems.push(`${key}: "${v}" must stay exactly as in English`);
    }
  }
  return { language, untranslated, problems };
}

function short(s: string, n = 90): string {
  const one = s.replace(/\n/g, '⏎');
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

async function main(args: string[]) {
  const asked = args.filter((a) => !a.startsWith('-'));
  for (const a of asked) {
    if (!(LANGUAGES as readonly string[]).includes(a)) {
      console.error(`Unknown language "${a}". Codes: ${LANGUAGES.join(', ')}`);
      process.exit(2);
    }
  }
  const en = await load('en');
  const targets = (asked.length ? asked : LANGUAGES.filter((l) => l !== 'en')) as Language[];
  let failed = false;
  for (const language of targets) {
    if (language === 'en') continue;
    const r = await check(language, en);
    if (r.untranslated.length || r.problems.length) failed = true;
    if (!asked.length) {
      const done = en.length - r.untranslated.length;
      console.log(
        `${language.padEnd(6)} ${String(r.untranslated.length).padStart(4)} untranslated` +
          `${r.problems.length ? `, ${r.problems.length} problems` : ''}  (${Math.round((done / en.length) * 100)}% done)`,
      );
      continue;
    }
    if (r.problems.length) {
      console.log(`\n${language}: ${r.problems.length} problems`);
      for (const p of r.problems) console.log(`  ${p}`);
    }
    for (const area of Object.keys(AREAS) as Area[]) {
      const left = r.untranslated.filter((e) => e.id.startsWith(`${area}:`));
      if (!left.length) continue;
      const file = area === 'web' ? `web/src/i18n/${language}.ts` : `server/src/i18n/${language}.ts`;
      console.log(`\n${file}: ${left.length} entries still in English`);
      for (const e of left) console.log(`  ${e.id.slice(area.length + 1).padEnd(44)} ${short(e.value)}`);
    }
    if (!r.untranslated.length && !r.problems.length) console.log(`${language}: everything is translated.`);
  }
  if (!asked.length) console.log(`\nDetails for one language: npm run i18n:check -- <code>`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main(process.argv.slice(2));
