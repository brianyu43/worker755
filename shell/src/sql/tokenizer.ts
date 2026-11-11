// SQL tokenizer, SQLite flavour. Tokens are produced one at a time so that an unterminated string
// late in a script only fails once the statements before it have run.

import { parseError } from './errors.ts';

export type TokType = 'id' | 'str' | 'num' | 'blob' | 'op' | 'var' | 'eof';

export interface Token {
  type: TokType;
  value: string; // identifier name (unquoted), string contents, number text, operator
  upper: string; // value upper-cased, for keyword checks ('' for quoted identifiers)
  quoted: boolean; // identifiers written as "x", [x] or `x`
  start: number;
  end: number;
}

/** Every SQLite keyword. Used to decide when generated SQL must quote a name. */
export const KEYWORDS = new Set(
  ('ABORT ACTION ADD AFTER ALL ALTER ALWAYS ANALYZE AND AS ASC ATTACH AUTOINCREMENT BEFORE BEGIN ' +
    'BETWEEN BY CASCADE CASE CAST CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS ' +
    'CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DEFERRABLE DEFERRED DELETE ' +
    'DESC DETACH DISTINCT DO DROP EACH ELSE END ESCAPE EXCEPT EXCLUDE EXCLUSIVE EXISTS EXPLAIN FAIL ' +
    'FILTER FIRST FOLLOWING FOR FOREIGN FROM FULL GENERATED GLOB GROUP GROUPS HAVING IF IGNORE ' +
    'IMMEDIATE IN INDEX INDEXED INITIALLY INNER INSERT INSTEAD INTERSECT INTO IS ISNULL JOIN KEY LAST ' +
    'LEFT LIKE LIMIT MATCH MATERIALIZED NATURAL NO NOT NOTHING NOTNULL NULL NULLS OF OFFSET ON OR ' +
    'ORDER OTHERS OUTER OVER PARTITION PLAN PRAGMA PRECEDING PRIMARY QUERY RAISE RANGE RECURSIVE ' +
    'REFERENCES REGEXP REINDEX RELEASE RENAME REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS ' +
    'SAVEPOINT SELECT SET TABLE TEMP TEMPORARY THEN TIES TO TRANSACTION TRIGGER UNBOUNDED UNION ' +
    'UNIQUE UPDATE USING VACUUM VALUES VIEW VIRTUAL WHEN WHERE WINDOW WITH WITHOUT').split(' '),
);

/** Keywords that can never be used as a bare identifier (the rest fall back to identifiers). */
export const RESERVED = new Set(
  ('ADD ALL ALTER AND AS AUTOINCREMENT BETWEEN CASE CHECK COLLATE COMMIT CONSTRAINT CREATE CROSS ' +
    'DEFAULT DEFERRABLE DELETE DISTINCT DROP ELSE ESCAPE EXCEPT EXISTS FOREIGN FROM FULL GROUP ' +
    'HAVING IN INDEX INDEXED INNER INSERT INTERSECT INTO IS ISNULL JOIN LEFT LIMIT NATURAL NOT ' +
    'NOTNULL NULL ON OR ORDER OUTER PRIMARY REFERENCES RETURNING RIGHT SELECT SET TABLE THEN TO ' +
    'TRANSACTION UNION UNIQUE UPDATE USING VALUES WHEN WHERE').split(' '),
);

const ID_START = /[A-Za-z_\u0080-\uffff]/;
const ID_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const ID_RUN = /[A-Za-z0-9_$\u0080-\uffff]*/y;
const NUM_RE = /0[xX][0-9a-fA-F]+|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const OPS2 = ['||', '<=', '>=', '==', '!=', '<>', '<<', '>>', '->'];
const OPS1 = '+-*/%<>=(),;.&|~';

/** End of the identifier-character run starting at `pos`. */
function idEnd(sql: string, pos: number): number {
  ID_RUN.lastIndex = pos;
  ID_RUN.exec(sql);
  return ID_RUN.lastIndex;
}

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function unrecognized(sql: string, start: number, end: number): never {
  throw parseError(`unrecognized token: "${sql.slice(start, end)}"`, start);
}

/** Skip whitespace and comments from `pos`. */
export function skipSpace(sql: string, pos: number): number {
  for (;;) {
    while (pos < sql.length && isSpace(sql.charCodeAt(pos))) pos++;
    if (sql.startsWith('--', pos)) {
      const nl = sql.indexOf('\n', pos);
      pos = nl < 0 ? sql.length : nl + 1;
      continue;
    }
    if (sql.startsWith('/*', pos)) {
      const close = sql.indexOf('*/', pos + 2);
      pos = close < 0 ? sql.length : close + 2;
      continue;
    }
    return pos;
  }
}

/** Read a quoted run starting at `pos` (the opening quote). Returns [contents, end]. */
function readQuoted(sql: string, pos: number, close: string): [string, number] {
  let out = '';
  let i = pos + 1;
  for (;;) {
    const j = sql.indexOf(close, i);
    if (j < 0) unrecognized(sql, pos, sql.length);
    out += sql.slice(i, j);
    if (close !== ']' && sql[j + 1] === close) {
      out += close;
      i = j + 2;
      continue;
    }
    return [out, j + 1];
  }
}

function mk(type: TokType, value: string, start: number, end: number, quoted = false): Token {
  return { type, value, upper: type === 'id' && !quoted ? value.toUpperCase() : '', quoted, start, end };
}

const OPS2_SET = new Set(OPS2);
const isDigit = (code: number) => code >= 48 && code <= 57;

/** The token starting at or after `pos`. */
export function lex(sql: string, pos: number): Token {
  const start = skipSpace(sql, pos);
  if (start >= sql.length) return mk('eof', '', start, start);
  const c = sql[start];
  const code = sql.charCodeAt(start);
  if (c === "'") {
    const [v, end] = readQuoted(sql, start, "'");
    return mk('str', v, start, end);
  }
  if (c === '"' || c === '`') {
    const [v, end] = readQuoted(sql, start, c);
    return mk('id', v, start, end, true);
  }
  if (c === '[') {
    const [v, end] = readQuoted(sql, start, ']');
    return mk('id', v, start, end, true);
  }
  if ((c === 'x' || c === 'X') && sql[start + 1] === "'") {
    const [v, end] = readQuoted(sql, start + 1, "'");
    if (v.length % 2 || /[^0-9a-fA-F]/.test(v)) unrecognized(sql, start, end);
    return mk('blob', v, start, end);
  }
  if (isDigit(code) || (c === '.' && isDigit(sql.charCodeAt(start + 1)))) {
    NUM_RE.lastIndex = start;
    NUM_RE.exec(sql);
    const end = NUM_RE.lastIndex;
    if (end < sql.length && ID_CHAR.test(sql[end])) unrecognized(sql, start, idEnd(sql, end));
    return mk('num', sql.slice(start, end), start, end);
  }
  if (ID_START.test(c)) {
    const end = idEnd(sql, start + 1);
    return mk('id', sql.slice(start, end), start, end);
  }
  if (c === '?' || c === ':' || c === '@' || c === '$') {
    const end = idEnd(sql, start + 1);
    return mk('var', sql.slice(start, end), start, end);
  }
  if (sql.startsWith('->>', start)) return mk('op', '->>', start, start + 3);
  const two = sql.slice(start, start + 2);
  if (OPS2_SET.has(two)) return mk('op', two, start, start + 2);
  if (OPS1.includes(c)) return mk('op', c, start, start + 1);
  return unrecognized(sql, start, start + 1);
}

/**
 * True when `sql` holds at least one complete statement: it ends with a `;` outside quotes and
 * comments, ignoring trailing whitespace and comments (what sqlite3_complete() checks).
 */
export function isComplete(sql: string): boolean {
  let i = 0;
  let last = '';
  while (i < sql.length) {
    const c = sql[i];
    if (isSpace(c.charCodeAt(0))) {
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      if (nl < 0) break;
      i = nl + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const close = sql.indexOf('*/', i + 2);
      if (close < 0) return false;
      i = close + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      for (;;) {
        const k = sql.indexOf(close, j);
        if (k < 0) return false;
        if (close !== ']' && sql[k + 1] === close) {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      i = j;
      last = 'x';
      continue;
    }
    last = c;
    i++;
  }
  return last === ';';
}
