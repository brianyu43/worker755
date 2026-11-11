// Value semantics: type affinity, conversions, comparison and pattern matching, following SQLite.

import type { SqlValue } from './errors.ts';

/** Column/expression affinity. null means "no affinity" (BLOB behaves the same in comparisons). */
export type Aff = 'INTEGER' | 'REAL' | 'NUMERIC' | 'TEXT' | 'BLOB' | null;

/** Affinity of a declared column type, by SQLite's substring rules. */
export function affinityOf(type: string): Aff {
  const t = type.toUpperCase();
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB') || t === '') return 'BLOB';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

export function isNumericAff(a: Aff): boolean {
  return a === 'INTEGER' || a === 'REAL' || a === 'NUMERIC';
}

const NUMERIC_TEXT = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const NUMERIC_PREFIX = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/** True when the whole string is a number, as needed for numeric affinity to convert it. */
export function looksNumeric(s: string): boolean {
  return NUMERIC_TEXT.test(s);
}

/** Text form of a number the way sqlite prints it (%.15g for reals). */
export function numToText(n: number): string {
  if (Number.isInteger(n)) return Object.is(n, -0) ? '0' : String(n);
  if (!Number.isFinite(n)) return n > 0 ? 'Inf' : n < 0 ? '-Inf' : '';
  return String(parseFloat(n.toPrecision(15)));
}

export function toText(v: SqlValue): string | null {
  if (v === null) return null;
  return typeof v === 'number' ? numToText(v) : v;
}

/** Numeric value for arithmetic: strings contribute their numeric prefix, or 0. */
export function toNumber(v: SqlValue): number {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  const m = NUMERIC_PREFIX.exec(v);
  return m ? Number(m[0]) : 0;
}

/** Truth value in a boolean context; NULL stays unknown. */
export function truth(v: SqlValue): boolean | null {
  if (v === null) return null;
  return toNumber(v) !== 0;
}

export function isTrue(v: SqlValue): boolean {
  return v !== null && toNumber(v) !== 0;
}

/** Apply a column's affinity to a value being stored. */
export function applyAffinity(v: SqlValue, aff: Aff): SqlValue {
  if (v === null || aff === 'BLOB' || aff === null) return v;
  if (aff === 'TEXT') return typeof v === 'number' ? numToText(v) : v;
  if (typeof v === 'string' && looksNumeric(v)) return Number(v.trim());
  return v;
}

/** Affinity applied to both operands of a comparison, from their own affinities. */
export function comparisonAffinity(a: Aff, b: Aff): 'NUMERIC' | 'TEXT' | null {
  const ha = a !== null && a !== 'BLOB';
  const hb = b !== null && b !== 'BLOB';
  if (ha && hb) return isNumericAff(a) || isNumericAff(b) ? 'NUMERIC' : null;
  if (!ha && !hb) return null;
  const one = ha ? a : b;
  return isNumericAff(one) ? 'NUMERIC' : 'TEXT';
}

export function convertFor(v: SqlValue, aff: 'NUMERIC' | 'TEXT' | null): SqlValue {
  if (aff === null || v === null) return v;
  if (aff === 'TEXT') return typeof v === 'number' ? numToText(v) : v;
  if (typeof v === 'string' && looksNumeric(v)) return Number(v.trim());
  return v;
}

export type Collation = 'BINARY' | 'NOCASE' | 'RTRIM';

export function collationOf(name: string | null | undefined): Collation | null {
  if (!name) return null;
  const n = name.toUpperCase();
  return n === 'NOCASE' || n === 'RTRIM' || n === 'BINARY' ? n : null;
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function collateKey(s: string, coll: Collation | null): string {
  if (coll === 'NOCASE') return asciiLower(s);
  if (coll === 'RTRIM') return s.replace(/ +$/, '');
  return s;
}

/** Total order used by comparisons and ORDER BY: NULL < numbers < text. */
export function compareValues(a: SqlValue, b: SqlValue, coll: Collation | null = null): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : -1) : 1;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return ta === 'number' ? -1 : 1;
  if (ta === 'number') return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
  const ka = collateKey(a as string, coll);
  const kb = collateKey(b as string, coll);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** A string key that is equal for values that compare equal (for DISTINCT, GROUP BY, UNIQUE). */
export function valueKey(v: SqlValue, coll: Collation | null = null): string {
  if (v === null) return 'N';
  if (typeof v === 'number') return 'n' + (Object.is(v, -0) ? 0 : v);
  return 's' + collateKey(v, coll);
}

export function rowKey(vals: SqlValue[]): string {
  return vals.map((v) => valueKey(v)).join('\u0000');
}

// ---- LIKE and GLOB --------------------------------------------------------------------------

const patternCache = new Map<string, RegExp>();

function cached(key: string, build: () => RegExp): RegExp {
  let re = patternCache.get(key);
  if (!re) {
    if (patternCache.size > 500) patternCache.clear();
    re = build();
    patternCache.set(key, re);
  }
  return re;
}

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** SQL LIKE: % and _, case-insensitive for ASCII letters, optional escape character. */
export function like(pattern: string, text: string, esc: string | null): boolean {
  const re = cached('L' + (esc ?? '') + '\u0000' + pattern, () => {
    let src = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (esc !== null && c === esc) {
        i++;
        if (i < pattern.length) src += escapeRe(pattern[i]);
        continue;
      }
      if (c === '%') src += '[\\s\\S]*';
      else if (c === '_') src += '[\\s\\S]';
      else if (/[a-zA-Z]/.test(c)) src += `[${c.toLowerCase()}${c.toUpperCase()}]`;
      else src += escapeRe(c);
    }
    return new RegExp('^' + src + '$');
  });
  return re.test(text);
}

/** SQL GLOB: *, ?, [...] and [^...], case-sensitive. */
export function glob(pattern: string, text: string): boolean {
  const re = cached('G' + pattern, () => {
    let src = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') src += '[\\s\\S]*';
      else if (c === '?') src += '[\\s\\S]';
      else if (c === '[') {
        const close = pattern.indexOf(']', i + 2);
        if (close < 0) {
          src += '\\[';
          continue;
        }
        let body = pattern.slice(i + 1, close);
        let neg = '';
        if (body.startsWith('^')) {
          neg = '^';
          body = body.slice(1);
        }
        src += '[' + neg + body.replace(/[\\\]]/g, '\\$&') + ']';
        i = close;
      } else src += escapeRe(c);
    }
    return new RegExp('^' + src + '$');
  });
  return re.test(text);
}

// ---- SQL literals ---------------------------------------------------------------------------

/** A value as an SQL literal: NULL, 12, 'it''s'. */
export function sqlLiteral(v: SqlValue): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v > 0 ? '1e999' : v < 0 ? '-1e999' : 'NULL';
    return Object.is(v, -0) ? '0' : String(v);
  }
  return "'" + v.replace(/'/g, "''") + "'";
}
