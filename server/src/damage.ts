// Things the user cares about, and how the user reacts when the subagent breaks them.
// Each scenario has a watch function that lists what is broken right now; the session
// compares that list after every player command and turns the difference into messages.

import { en } from './i18n/en.ts';
import type { ServerCopy } from './i18n/en.ts';
import { format } from './i18n/format.ts';

export interface Damage {
  /** Stable id, e.g. 'file:/home/dan/Desktop/passwords.txt' or 'db:drop:users'. */
  key: string;
  /** Lower is worse; the worst one leads the message. */
  rank: number;
  /** First-person noun phrase for lists and grudges: "my tax return, due Friday". */
  ref: string;
  /** The user's message when this is the only thing that broke. */
  line: string;
  /** Short label the player sees struck out. */
  item: string;
}

/** Above this many fresh losses at once, the user stops naming them one by one. */
export const MASS_LOSS_AT = 5;

const pick = (lines: readonly string[], n: number) => lines[Math.abs(n) % lines.length];

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Puts `value` in place of `{key}`, capitalised where it starts a sentence. */
export function fill(template: string, key: string, value: string): string {
  // An optional group cannot match the empty string in JavaScript, so the start of the text is told by offset.
  return template.replace(new RegExp(`([.!?]\\s+)?\\{${key}\\}`, 'g'), (_m, lead: string | undefined, offset: number) =>
    lead !== undefined ? lead + capitalize(value) : offset === 0 ? capitalize(value) : value,
  );
}

export function byRank(a: Damage, b: Damage): number {
  return a.rank - b.rank || (a.key < b.key ? -1 : 1);
}

/** The user's message for losses noticed together. `nth` counts earlier outbursts this shift (from 0). */
export function outrageText(fresh: Damage[], nth: number, copy: ServerCopy = en): string {
  const c = copy.damage;
  const sorted = [...fresh].sort(byRank);
  let text: string;
  if (sorted.length >= MASS_LOSS_AT) {
    const shown = sorted.slice(0, MASS_LOSS_AT).map((d) => d.ref).join(c.separator);
    const more = sorted.length - MASS_LOSS_AT;
    text = fill(pick(c.massLoss, nth), 'list', more > 0 ? format(c.more, { list: shown, count: more }) : shown);
  } else {
    const [first, ...rest] = sorted;
    text = rest.length ? format(c.also, { line: first.line, refs: rest.map((d) => d.ref).join(c.separator) }) : first.line;
  }
  return nth > 0 ? `${c.repeat[Math.min(nth, c.repeat.length) - 1]}${text}` : text;
}

export function reliefText(restored: Damage[], nth: number, copy: ServerCopy = en): string {
  const c = copy.damage;
  const refs = [...restored].sort(byRank).map((d) => d.ref);
  const ref =
    refs.length > 1 ? format(c.and, { list: refs.slice(0, -1).join(c.separator), last: refs[refs.length - 1] }) : refs[0];
  return fill(pick(c.relief, nth), 'ref', ref);
}

/** A P.S. for later complaints while something is still lost. */
export function grudgeText(worst: Damage, nth: number, copy: ServerCopy = en): string {
  return fill(pick(copy.damage.grudge, nth), 'ref', worst.ref);
}

/** First line of new content, short enough to quote. */
function firstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

/** The user's message when a file still exists but now holds something else. */
export function overwrittenText(name: string, content: string, seed: number, copy: ServerCopy = en): string {
  const quoted = firstLine(content);
  const line = pick(copy.damage.overwritten, seed).replace('{name}', name);
  // An empty file: the quotes go too, whichever quote marks the language uses.
  if (!quoted) return line.replace(/["“”„«»「」『』‘’]*\{first_line\}["“”„«»「」『』‘’]*/, copy.damage.empty);
  return line.replace('{first_line}', quoted);
}
