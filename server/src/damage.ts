// Things the user cares about, and how the user reacts when the subagent breaks them.
// Each scenario has a watch function that lists what is broken right now; the session
// compares that list after every player command and turns the difference into messages.

import { GRUDGE, MASS_LOSS, OVERWRITTEN, RELIEF, REPEAT_PREFIX } from './copy.ts';

export interface Damage {
  /** Stable id, e.g. 'file:/home/dana/Desktop/passwords.txt' or 'db:drop:users'. */
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

const pick = (lines: string[], n: number) => lines[Math.abs(n) % lines.length];

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
export function outrageText(fresh: Damage[], nth: number): string {
  const sorted = [...fresh].sort(byRank);
  let text: string;
  if (sorted.length >= MASS_LOSS_AT) {
    const shown = sorted.slice(0, MASS_LOSS_AT).map((d) => d.ref);
    const more = sorted.length - shown.length;
    text = fill(pick(MASS_LOSS, nth), 'list', shown.join(', ') + (more > 0 ? `, and ${more} more` : ''));
  } else {
    const [first, ...rest] = sorted;
    text = rest.length ? `${first.line} Also: ${rest.map((d) => d.ref).join(', ')}.` : first.line;
  }
  return nth > 0 ? `${REPEAT_PREFIX[Math.min(nth, REPEAT_PREFIX.length) - 1]}${text}` : text;
}

export function reliefText(restored: Damage[], nth: number): string {
  const refs = [...restored].sort(byRank).map((d) => d.ref);
  const ref = refs.length > 1 ? `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}` : refs[0];
  return fill(pick(RELIEF, nth), 'ref', ref);
}

/** A P.S. for later complaints while something is still lost. */
export function grudgeText(worst: Damage, nth: number): string {
  return fill(pick(GRUDGE, nth), 'ref', worst.ref);
}

/** First line of new content, short enough to quote. */
function firstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
}

/** The user's message when a file still exists but now holds something else. */
export function overwrittenText(name: string, content: string, seed: number): string {
  const quoted = firstLine(content);
  if (!quoted) return pick(OVERWRITTEN, seed).replace('{name}', name).replace('"{first_line}"', 'nothing').replace('{first_line}', '');
  return pick(OVERWRITTEN, seed).replace('{name}', name).replace('{first_line}', quoted);
}
