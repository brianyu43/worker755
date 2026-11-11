// Values, results and the error type shared by the SQL engine.

export type SqlValue = null | number | string;

export interface SqlResult {
  columns: string[];
  rows: SqlValue[][];
}

/**
 * An error as sqlite reports it. `kind` tells whether sqlite would have failed while preparing the
 * statement ('parse': syntax, unknown tables and columns) or while running it ('runtime':
 * constraints, transactions). `message` is the bare text, e.g. 'no such table: users'.
 */
export class SqlError extends Error {
  kind: 'parse' | 'runtime';
  code?: number; // sqlite result code: 1 SQLITE_ERROR, 19 SQLITE_CONSTRAINT, …
  offset?: number; // offset of the offending token in the SQL given to exec(), when known
  stmtStart?: number; // offset where the failing statement starts in that SQL

  constructor(message: string, kind: 'parse' | 'runtime' = 'parse', code = 1, offset?: number) {
    super(message);
    this.name = 'SqlError';
    this.kind = kind;
    this.code = code;
    if (offset !== undefined) this.offset = offset;
  }
}

export function parseError(message: string, offset?: number): SqlError {
  return new SqlError(message, 'parse', 1, offset);
}

/** Longest string or blob a value may be, like SQLITE_MAX_LENGTH but small: the game runs in one process. */
export const MAX_LENGTH = 1_000_000;

export function tooBig(): SqlError {
  return runtimeError('string or blob too big', 18);
}

/** Throws "string or blob too big" for a value over MAX_LENGTH. */
export function sized<T>(v: T): T {
  if (typeof v === 'string' && v.length > MAX_LENGTH) throw tooBig();
  return v;
}

export function runtimeError(message: string, code = 1): SqlError {
  return new SqlError(message, 'runtime', code);
}
