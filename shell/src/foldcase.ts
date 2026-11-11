// Case-insensitive matching without the regex `i` flag. V8 falls back to its linear-time engine for
// patterns that backtrack too much (the server turns that on), but not for patterns with the `i` flag,
// so a case-insensitive pattern is rewritten to spell out both cases instead: `a` becomes `[aA]`,
// `[a-z]` becomes `[a-zA-Z]`. Escapes (`\w`, `\x41`, `\u{...}`) are copied as they are.

/** The other case of a single character, or null when it has none of the same length. */
function other(c: string): string | null {
  const lo = c.toLowerCase();
  const up = c.toUpperCase();
  const o = c === lo ? up : lo;
  return o !== c && o.length === c.length ? o : null;
}

/** Characters an escape at `i` (the backslash) spans, so it can be copied whole. */
function escapeLength(src: string, i: number): number {
  const n = src[i + 1];
  if (n === 'x') return 4;
  if (n === 'c') return 3;
  if ((n === 'u' || n === 'p' || n === 'P') && src[i + 2] === '{') {
    const end = src.indexOf('}', i + 3);
    return end < 0 ? 2 : end - i + 1;
  }
  if (n === 'u') return 6;
  return 2;
}

/** A JavaScript regex source that matches what `src` matches with the `i` flag, without it. */
export function foldCase(src: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '\\') {
      const len = escapeLength(src, i);
      out += src.slice(i, i + len);
      i += len;
      continue;
    }
    if (inClass) {
      if (c === ']') {
        inClass = false;
        out += c;
        i++;
        continue;
      }
      // A range of letters gets its other case too: a-z -> a-zA-Z.
      if (src[i + 1] === '-' && src[i + 2] !== undefined && src[i + 2] !== ']' && src[i + 2] !== '\\') {
        const from = c;
        const to = src[i + 2];
        out += `${from}-${to}`;
        const of = other(from);
        const ot = other(to);
        if (of && ot && (of < ot) === (from < to)) out += `${of}-${ot}`;
        i += 3;
        continue;
      }
      out += c + (other(c) ?? '');
      i++;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      i++;
      if (src[i] === '^') out += src[i++];
      if (src[i] === ']') out += src[i++];
      continue;
    }
    const o = other(c);
    out += o ? `[${c}${o}]` : c;
    i++;
  }
  return out;
}
