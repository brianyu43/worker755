// The database: schema, rows, statement execution, transactions and the .dump text format.
//
// Statements are compiled into closures before they run, so name errors ("no such column") are
// reported even when no row is ever evaluated, as sqlite reports them at prepare time.

import { parseError, runtimeError, sized, SqlError } from './errors.ts';
import type { SqlResult, SqlValue } from './errors.ts';
import { parseColumnDef, Parser, parseTableDef, parseViewSelect } from './parser.ts';
import type { Core, Cte, Expr, FromItem, OrderTerm, ResultCol, Select, SetClause, Stmt, TableDef, TableName } from './ast.ts';
import { KEYWORDS, lex } from './tokenizer.ts';
import { AGGREGATES, isAggregate, SCALARS, WINDOW_ONLY } from './functions.ts';
import type { AggFn, FnContext } from './functions.ts';
import {
  affinityOf, applyAffinity, collationOf, compareValues, comparisonAffinity, convertFor, glob, isTrue, like,
  numToText, rowKey, sqlLiteral, toNumber, toText, truth, valueKey,
} from './values.ts';
import type { Aff, Collation } from './values.ts';

// ---- schema objects -------------------------------------------------------------------------

interface Row {
  rowid: number;
  values: SqlValue[];
}

interface Col {
  name: string;
  type: string;
  aff: Aff;
  notNull: boolean;
  dflt: Expr | null;
  dfltText: string | null;
  coll: Collation | null;
  pk: number; // 1-based position in the primary key, 0 when not part of it
  unique: boolean;
}

interface UniqueIdx {
  cols: number[];
  map: Map<string, Row>;
  index: string | null; // name of the UNIQUE INDEX, null for a table constraint
}

interface Table {
  kind: 'table';
  name: string;
  sql: string;
  def: TableDef;
  cols: Col[];
  rows: Row[];
  rowidCol: number; // the INTEGER PRIMARY KEY column, or -1
  autoinc: boolean;
  uniques: UniqueIdx[];
}

interface Index {
  kind: 'index';
  name: string;
  tblName: string;
  sql: string;
  unique: boolean;
  cols: (number | null)[]; // null for expressions
  partial: boolean;
}

interface View {
  kind: 'view';
  name: string;
  sql: string;
}

type SchemaObj = Table | Index | View;

const SEQ_SQL = 'CREATE TABLE sqlite_sequence(name,seq)';
const MASTER_COLS = ['type', 'name', 'tbl_name', 'rootpage', 'sql'];

// ---- compiled expressions -------------------------------------------------------------------

interface Env {
  rows: (SqlValue[] | null)[];
  rowids: (number | null)[];
  parent: Env | null;
  agg: SqlValue[] | null;
  win: SqlValue[] | null;
}

interface CExpr {
  ev: (env: Env) => SqlValue;
  aff: Aff;
  coll: Collation | null;
  collX: boolean; // collation given explicitly with COLLATE
  real: boolean; // statically known to be a REAL
  colName?: string; // for column references: the declared column name
  src?: [number, number]; // for column references into the current scope: [source, column]
}

interface SrcCol {
  name: string;
  aff: Aff;
  coll: Collation | null;
  real: boolean;
  hidden: boolean; // right-hand column of USING / NATURAL, skipped by * and unqualified names
}

interface Source {
  name: string; // lower-cased alias or table name
  cols: SrcCol[];
  rowid: boolean;
  rows: (env: Env) => Row[];
  on: CExpr | null;
  left: boolean;
  probe: Probe | null; // equality lookup that narrows the rows to scan
}

/** `col = key` where key only depends on earlier sources: look rows up by hash instead of scanning. */
interface Probe {
  ci: number;
  key: CExpr;
  aff: 'NUMERIC' | 'TEXT' | null;
  coll: Collation | null;
  cache: { rows: Row[] | null; map: Map<string, Row[]> };
}

function probeRows(p: Probe, rows: Row[], v: SqlValue): Row[] {
  if (v === null) return [];
  if (p.cache.rows !== rows) {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const x = r.values[p.ci];
      if (x === null) continue;
      const k = valueKey(convertFor(x, p.aff), p.coll);
      const bucket = map.get(k);
      if (bucket) bucket.push(r);
      else map.set(k, [r]);
    }
    p.cache = { rows, map };
  }
  return p.cache.map.get(valueKey(convertFor(v, p.aff), p.coll)) ?? [];
}

/** The AND-ed terms of a condition. */
function conjuncts(e: Expr): Expr[] {
  return e.k === 'bin' && e.op === 'AND' ? [...conjuncts(e.l), ...conjuncts(e.r)] : [e];
}

interface AggSlot {
  name: string;
  fn: AggFn;
  args: CExpr[];
  distinct: boolean;
  filter: CExpr | null;
}

interface WinSlot {
  name: string;
  agg: AggFn | null;
  args: CExpr[];
  distinct: boolean;
  filter: CExpr | null;
  partition: CExpr[];
  order: { c: CExpr; desc: boolean; nulls: OrderTerm['nulls'] }[];
}

interface CteDef {
  names: string[];
  cols: SrcCol[];
  rows: () => Row[];
}

interface CteChain {
  defs: Map<string, CteDef>;
  up: CteChain | null;
}

interface Scope {
  sources: Source[];
  parent: Scope | null;
  ctes: CteChain | null;
  correlated: boolean;
  agg: AggSlot[] | null;
  aggAllowed: boolean;
  inAggArgs: boolean;
  win: WinSlot[] | null;
  winAllowed: boolean;
  aliases: Map<string, Expr> | null;
  aliasGuard: Set<string>;
  track: Set<number> | null; // while set, collects the sources of this scope an expression reads
}

interface Plan {
  names: string[];
  cols: SrcCol[];
  run: (penv: Env | null) => SqlValue[][];
  correlated: boolean;
}

interface Returning {
  names: string[];
  exprs: CExpr[];
}

interface OutRow {
  vals: SqlValue[];
  keys: SqlValue[] | null;
}

function mkEnv(n: number, parent: Env | null): Env {
  return { rows: new Array(n).fill(null), rowids: new Array(n).fill(null), parent, agg: null, win: null };
}

function newScope(parent: Scope | null, ctes: CteChain | null): Scope {
  return {
    sources: [], parent, ctes, correlated: false, agg: null, aggAllowed: false, inAggArgs: false,
    win: null, winAllowed: false, aliases: null, aliasGuard: new Set(), track: null,
  };
}

function cexpr(ev: (env: Env) => SqlValue, opts: Partial<CExpr> = {}): CExpr {
  return { ev, aff: null, coll: null, collX: false, real: false, ...opts };
}

const lower = (s: string) => s.toLowerCase();

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Quote a name for generated SQL when sqlite would. */
export function quoteIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name.toUpperCase())) return name;
  return '"' + name.replace(/"/g, '""') + '"';
}

function lowerBound(rows: Row[], rowid: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].rowid < rowid) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function hasAgg(e: Expr | null): boolean {
  if (!e) return false;
  switch (e.k) {
    case 'fn':
      if (!e.over && isAggregate(e.name, e.args.length)) return true;
      return e.args.some(hasAgg) || hasAgg(e.filter);
    case 'unary':
    case 'collate':
    case 'cast':
    case 'isnull':
      return hasAgg(e.e);
    case 'bin':
      return hasAgg(e.l) || hasAgg(e.r);
    case 'like':
      return hasAgg(e.l) || hasAgg(e.r) || hasAgg(e.esc);
    case 'between':
      return hasAgg(e.e) || hasAgg(e.lo) || hasAgg(e.hi);
    case 'in':
      return hasAgg(e.e) || (e.list ?? []).some(hasAgg);
    case 'case':
      return hasAgg(e.base) || e.whens.some(([a, b]) => hasAgg(a) || hasAgg(b)) || hasAgg(e.els);
    default:
      return false;
  }
}

function numInfo(v: SqlValue): [number, boolean] {
  if (typeof v === 'number') return [v, Number.isInteger(v)];
  const n = toNumber(v);
  if (typeof v === 'string') {
    const m = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(v);
    return [n, !m || !/[.eE]/.test(m[0])];
  }
  return [n, true];
}

function toBig(n: number): bigint {
  return BigInt(Math.trunc(n));
}

// ---- the database ---------------------------------------------------------------------------

export interface DatabaseOptions {
  now?: () => number;
  readonly?: boolean;
}

export interface SchemaEntry {
  type: 'table' | 'index' | 'view';
  name: string;
  tblName: string;
  sql: string;
}

/** Row combinations one statement may visit, about a second of work. */
export const WORK_LIMIT = 5_000_000;

export class Database {
  /** Refuse writes with "attempt to write a readonly database", as `sqlite3 -readonly` does. */
  readonly: boolean;
  private objects: SchemaObj[] = [];
  private undoLog: (() => void)[] = [];
  private inTx = false;
  private savepoints: { name: string; mark: number; startedTx: boolean }[] = [];
  private clock: () => number;
  private stmtNow = 0;
  private changesN = 0;
  private totalChangesN = 0;
  private lastRowid = 0;
  private fnCtx: FnContext;
  /** Row combinations visited by the statement running now; see WORK_LIMIT. */
  private work = 0;

  constructor(options: DatabaseOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.readonly = options.readonly ?? false;
    this.fnCtx = {
      now: () => this.stmtNow,
      changes: () => this.changesN,
      totalChanges: () => this.totalChangesN,
      lastInsertRowid: () => this.lastRowid,
    };
  }

  /** Load a database from its .dump text (or any script of SQL statements). */
  static load(text: string, options: DatabaseOptions = {}): Database {
    const db = new Database({ now: options.now });
    try {
      db.exec(text);
    } catch (e) {
      if (e instanceof SqlError) throw new SqlError('file is not a database', 'parse', 26);
      throw e;
    }
    if (db.inTx) {
      db.inTx = false;
      db.savepoints = [];
      db.undoLog = [];
    }
    db.changesN = 0;
    db.totalChangesN = 0;
    db.lastRowid = 0;
    db.readonly = options.readonly ?? false;
    return db;
  }

  /** Run every statement; one result per statement that returns rows. Throws the first error. */
  exec(sql: string): SqlResult[] {
    const out: SqlResult[] = [];
    this.execStream(sql, (r) => out.push(r));
    return out;
  }

  query(sql: string): SqlResult {
    const rs = this.exec(sql);
    return rs.length ? rs[rs.length - 1] : { columns: [], rows: [] };
  }

  /** Like exec(), but hands over each result as soon as its statement has run. */
  execStream(sql: string, onResult: (result: SqlResult) => void): void {
    const parser = new Parser(sql);
    for (;;) {
      const ps = parser.next();
      if (!ps) return;
      const mark = this.undoLog.length;
      try {
        this.stmtNow = this.clock();
        this.work = 0;
        this.run(ps.stmt, onResult);
        if (!this.inTx) this.undoLog.length = 0;
      } catch (e) {
        if (!(e instanceof SqlError)) throw e;
        this.unwind(mark);
        if (!this.inTx) this.undoLog.length = 0;
        if (e.stmtStart === undefined) e.stmtStart = ps.start;
        throw e;
      }
    }
  }

  get inTransaction(): boolean {
    return this.inTx;
  }

  /** Roll back an open transaction, as closing the connection does. */
  rollbackOpen(): void {
    if (!this.inTx) return;
    this.unwind(0);
    this.undoLog = [];
    this.inTx = false;
    this.savepoints = [];
  }

  tableNames(): string[] {
    return this.tables().filter((t) => !lower(t.name).startsWith('sqlite_')).map((t) => t.name);
  }

  table(name: string): SqlResult | null {
    const t = this.findTable(name);
    if (!t) return null;
    return { columns: t.cols.map((c) => c.name), rows: t.rows.map((r) => r.values.slice()) };
  }

  /** Stored CREATE statements in creation order (what .schema prints). */
  schema(): SchemaEntry[] {
    return this.objects.map((o) => ({ type: o.kind, name: o.name, tblName: o.kind === 'index' ? o.tblName : o.name, sql: o.sql }));
  }

  /** The .dump text; `only` limits it to tables matching these LIKE patterns. */
  dump(only?: string[]): string {
    const want = (name: string) => !only || only.some((p) => like(p, name, null));
    let out = 'PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n';
    let seq: Table | null = null;
    for (const t of this.tables()) {
      if (lower(t.name) === 'sqlite_sequence') {
        seq = t;
        continue;
      }
      if (!want(t.name)) continue;
      out += t.sql + ';\n';
      const ins = `INSERT INTO ${quoteIdent(t.name)} VALUES(`;
      for (const r of t.rows) {
        out += ins + r.values.map((v, i) => {
          if (typeof v === 'number' && t.cols[i].aff === 'REAL' && Number.isInteger(v) && Math.abs(v) < 1e15) return `${v}.0`;
          return sqlLiteral(v);
        }).join(',') + ');\n';
      }
    }
    if (seq && !only) {
      out += 'DELETE FROM sqlite_sequence;\n';
      for (const r of seq.rows) out += `INSERT INTO sqlite_sequence VALUES(${r.values.map(sqlLiteral).join(',')});\n`;
    }
    for (const o of this.objects) {
      if (o.kind === 'index' && want(o.tblName)) out += o.sql + ';\n';
      if (o.kind === 'view' && want(o.name)) out += o.sql + ';\n';
    }
    return out + 'COMMIT;\n';
  }

  // ---- schema lookup --------------------------------------------------------------------

  private tables(): Table[] {
    return this.objects.filter((o): o is Table => o.kind === 'table');
  }

  private findObj(name: string): SchemaObj | null {
    const n = lower(name);
    return this.objects.find((o) => lower(o.name) === n) ?? null;
  }

  private findTable(name: string): Table | null {
    const o = this.findObj(name);
    return o && o.kind === 'table' ? o : null;
  }

  private checkSchema(t: TableName): void {
    if (t.schema && !['main', 'temp'].includes(lower(t.schema))) throw parseError(`unknown database ${t.schema}`, t.pos);
  }

  private isMaster(name: string): boolean {
    return ['sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'sqlite_temp_schema'].includes(lower(name));
  }

  /** The target of INSERT / UPDATE / DELETE. */
  private targetTable(tn: TableName): Table {
    this.checkSchema(tn);
    if (this.isMaster(tn.name)) throw parseError(`table ${tn.name} may not be modified`, tn.pos);
    const o = this.findObj(tn.name);
    if (!o || o.kind === 'index') throw parseError(`no such table: ${tn.schema ? tn.schema + '.' : ''}${tn.name}`, tn.pos);
    if (o.kind === 'view') throw parseError(`cannot modify ${o.name} because it is a view`, tn.pos);
    return o;
  }

  private checkWritable(): void {
    if (this.readonly) throw runtimeError('attempt to write a readonly database', 8);
  }

  private buildTable(name: string, sql: string): Table {
    const def = parseTableDef(sql);
    const cols: Col[] = [];
    const seen = new Set<string>();
    for (const c of def.cols) {
      if (seen.has(lower(c.name))) throw parseError(`duplicate column name: ${c.name}`);
      seen.add(lower(c.name));
      cols.push({
        name: c.name, type: c.type, aff: affinityOf(c.type), notNull: c.notNull, dflt: c.dflt, dfltText: c.dfltText,
        coll: collationOf(c.coll), pk: 0, unique: c.unique,
      });
    }
    const colIdx = (n: string) => {
      const i = cols.findIndex((c) => lower(c.name) === lower(n));
      if (i < 0) throw parseError(`no such column: ${n}`);
      return i;
    };
    let pkCols: number[] | null = null;
    let pkDesc = false;
    let autoinc = false;
    def.cols.forEach((c, i) => {
      if (!c.pk) return;
      if (pkCols) throw parseError(`table "${name}" has more than one primary key`);
      pkCols = [i];
      pkDesc = c.pk.desc;
      autoinc = c.pk.autoinc;
    });
    const uniqueSets: number[][] = [];
    for (const k of def.constraints) {
      if (k.k === 'pk') {
        if (pkCols) throw parseError(`table "${name}" has more than one primary key`);
        pkCols = k.cols.map((r) => colIdx(r.name));
      } else if (k.k === 'unique') {
        uniqueSets.push(k.cols.map((r) => colIdx(r.name)));
      } else {
        k.cols.forEach((r) => colIdx(r.name));
      }
    }
    let rowidCol = -1;
    const pk = pkCols as number[] | null;
    if (pk) {
      pk.forEach((ci, j) => (cols[ci].pk = j + 1));
      if (pk.length === 1 && cols[pk[0]].type.toUpperCase() === 'INTEGER' && !pkDesc) rowidCol = pk[0];
    }
    if (autoinc && rowidCol < 0) throw parseError('AUTOINCREMENT is only allowed on an INTEGER PRIMARY KEY');
    const sets: number[][] = [];
    if (pk && rowidCol < 0) sets.push(pk);
    cols.forEach((c, i) => c.unique && sets.push([i]));
    sets.push(...uniqueSets);
    const uniques: UniqueIdx[] = [];
    for (const s of sets) {
      if (uniques.some((u) => u.cols.join() === s.join())) continue;
      uniques.push({ cols: s, map: new Map(), index: null });
    }
    return { kind: 'table', name, sql, def, cols, rows: [], rowidCol, autoinc, uniques };
  }

  private ukey(t: Table, u: UniqueIdx, vals: SqlValue[]): string | null {
    let k = '';
    for (const c of u.cols) {
      const v = vals[c];
      if (v === null) return null;
      k += valueKey(v, t.cols[c].coll) + '\u0000';
    }
    return k;
  }

  /** Fill the unique-key maps of a table from its rows; throws on duplicates. */
  private fillUnique(t: Table, u: UniqueIdx): void {
    u.map.clear();
    for (const r of t.rows) {
      const k = this.ukey(t, u, r.values);
      if (k === null) continue;
      if (u.map.has(k)) throw runtimeError(`UNIQUE constraint failed: ${u.cols.map((c) => `${t.name}.${t.cols[c].name}`).join(', ')}`, 19);
      u.map.set(k, r);
    }
  }

  // ---- row mutation (every change is logged for rollback) -------------------------------

  private log(fn: () => void): void {
    this.undoLog.push(fn);
  }

  private unwind(mark: number): void {
    while (this.undoLog.length > mark) this.undoLog.pop()!();
  }

  private setObjects(objs: SchemaObj[]): void {
    const prev = this.objects;
    this.objects = objs;
    this.log(() => {
      this.objects = prev;
    });
  }

  private findRowid(t: Table, rowid: number): Row | null {
    const i = lowerBound(t.rows, rowid);
    return i < t.rows.length && t.rows[i].rowid === rowid ? t.rows[i] : null;
  }

  private placeRow(t: Table, row: Row): void {
    const rows = t.rows;
    if (rows.length === 0 || rows[rows.length - 1].rowid < row.rowid) rows.push(row);
    else rows.splice(lowerBound(rows, row.rowid), 0, row);
  }

  private unplaceRow(t: Table, row: Row): void {
    const i = lowerBound(t.rows, row.rowid);
    if (t.rows[i] === row) t.rows.splice(i, 1);
  }

  private indexRow(t: Table, row: Row): void {
    for (const u of t.uniques) {
      const k = this.ukey(t, u, row.values);
      if (k !== null) u.map.set(k, row);
    }
  }

  private unindexRow(t: Table, row: Row): void {
    for (const u of t.uniques) {
      const k = this.ukey(t, u, row.values);
      if (k !== null && u.map.get(k) === row) u.map.delete(k);
    }
  }

  private addRow(t: Table, row: Row): void {
    this.placeRow(t, row);
    this.indexRow(t, row);
    this.log(() => {
      this.unindexRow(t, row);
      this.unplaceRow(t, row);
    });
  }

  private replaceRow(t: Table, old: Row, row: Row): void {
    this.unindexRow(t, old);
    if (old.rowid === row.rowid) t.rows[lowerBound(t.rows, old.rowid)] = row;
    else {
      this.unplaceRow(t, old);
      this.placeRow(t, row);
    }
    this.indexRow(t, row);
    this.log(() => {
      this.unindexRow(t, row);
      if (old.rowid === row.rowid) t.rows[lowerBound(t.rows, row.rowid)] = old;
      else {
        this.unplaceRow(t, row);
        this.placeRow(t, old);
      }
      this.indexRow(t, old);
    });
  }

  private deleteRows(t: Table, dead: Set<Row>): void {
    if (dead.size === 0) return;
    const old = t.rows;
    t.rows = old.filter((r) => !dead.has(r));
    for (const r of dead) this.unindexRow(t, r);
    this.log(() => {
      t.rows = old;
      for (const r of dead) this.indexRow(t, r);
    });
  }

  // ---- AUTOINCREMENT bookkeeping --------------------------------------------------------

  private seqRow(name: string): Row | null {
    const seq = this.findTable('sqlite_sequence');
    if (!seq) return null;
    return seq.rows.find((r) => typeof r.values[0] === 'string' && lower(r.values[0]) === lower(name)) ?? null;
  }

  private nextRowid(t: Table): number {
    let max = t.rows.length ? t.rows[t.rows.length - 1].rowid : 0;
    if (t.autoinc) {
      const r = this.seqRow(t.name);
      if (r) max = Math.max(max, toNumber(r.values[1]));
    }
    return max + 1;
  }

  private bumpSeq(t: Table, rowid: number): void {
    if (!t.autoinc) return;
    const seq = this.findTable('sqlite_sequence');
    if (!seq) return;
    const r = this.seqRow(t.name);
    if (!r) this.addRow(seq, { rowid: this.nextRowid(seq), values: [t.name, rowid] });
    else if (toNumber(r.values[1]) < rowid) this.replaceRow(seq, r, { rowid: r.rowid, values: [r.values[0], rowid] });
  }

  // ---- statements -----------------------------------------------------------------------

  private run(st: Stmt, onResult: (r: SqlResult) => void): void {
    switch (st.k) {
      case 'select': {
        const plan = this.compileSelect(st, null, null);
        onResult({ columns: plan.names, rows: plan.run(null) });
        return;
      }
      case 'insert':
        return this.execInsert(st, onResult);
      case 'update':
        return this.execUpdate(st, onResult);
      case 'delete':
        return this.execDelete(st, onResult);
      case 'createTable':
        return this.execCreateTable(st);
      case 'createIndex':
        return this.execCreateIndex(st);
      case 'createView':
        return this.execCreateView(st);
      case 'drop':
        return this.execDrop(st);
      case 'alter':
        return this.execAlter(st);
      case 'begin':
        if (this.inTx) throw runtimeError('cannot start a transaction within a transaction');
        this.inTx = true;
        this.undoLog = [];
        return;
      case 'commit':
        if (!this.inTx) throw runtimeError('cannot commit - no transaction is active');
        this.inTx = false;
        this.undoLog = [];
        this.savepoints = [];
        return;
      case 'rollback': {
        if (st.to !== null) {
          const i = this.findSavepoint(st.to);
          this.unwind(this.savepoints[i].mark);
          this.savepoints.length = i + 1;
          return;
        }
        if (!this.inTx) throw runtimeError('cannot rollback - no transaction is active');
        this.rollbackOpen();
        return;
      }
      case 'savepoint': {
        const startedTx = !this.inTx;
        if (startedTx) {
          this.inTx = true;
          this.undoLog = [];
        }
        this.savepoints.push({ name: st.name, mark: this.undoLog.length, startedTx });
        return;
      }
      case 'release': {
        const i = this.findSavepoint(st.name);
        const startedTx = this.savepoints[i].startedTx;
        this.savepoints.length = i;
        if (startedTx) {
          this.inTx = false;
          this.undoLog = [];
          this.savepoints = [];
        }
        return;
      }
      case 'pragma':
        return this.execPragma(st, onResult);
      case 'noop':
        return;
    }
  }

  private findSavepoint(name: string): number {
    for (let i = this.savepoints.length - 1; i >= 0; i--) if (lower(this.savepoints[i].name) === lower(name)) return i;
    throw runtimeError(`no such savepoint: ${name}`);
  }

  private colIndex(t: Table, name: string): number {
    const n = lower(name);
    const i = t.cols.findIndex((c) => lower(c.name) === n);
    if (i >= 0) return i;
    if (t.rowidCol >= 0 && (n === 'rowid' || n === 'oid' || n === '_rowid_')) return t.rowidCol;
    return -1;
  }

  private tableSource(t: Table, alias: string | null): Source {
    return {
      name: lower(alias ?? t.name),
      cols: t.cols.map((c) => ({ name: c.name, aff: c.aff, coll: c.coll, real: c.aff === 'REAL', hidden: false })),
      rowid: true,
      rows: () => t.rows,
      on: null,
      left: false,
      probe: null,
    };
  }

  private defaultValue(t: Table, i: number): SqlValue {
    const c = t.cols[i];
    if (!c.dflt) return null;
    return applyAffinity(this.compile(c.dflt, newScope(null, null)).ev(mkEnv(0, null)), c.aff);
  }

  private compileReturning(cols: ResultCol[] | null, t: Table, alias: string | null): Returning | null {
    if (!cols) return null;
    const sc = newScope(null, null);
    sc.sources.push(this.tableSource(t, alias));
    const { names, exprs } = this.resultList(cols, sc);
    return { names, exprs };
  }

  private returningRows(ret: Returning, rows: Row[]): SqlValue[][] {
    const env = mkEnv(1, null);
    return rows.map((r) => {
      env.rows[0] = r.values;
      env.rowids[0] = r.rowid;
      return ret.exprs.map((c) => c.ev(env));
    });
  }

  /** Compile WITH clauses; CTE bodies cannot see outer queries. */
  private ctes(withs: Cte[] | null, base: CteChain | null): CteChain | null {
    if (!withs) return base;
    const defs = new Map<string, CteDef>();
    const chain: CteChain = { defs, up: base };
    for (const w of withs) {
      if (w.recursive && w.sel.cores.length > 1 && refersTo(w.sel.cores.slice(1), lower(w.name))) {
        defs.set(lower(w.name), this.recursiveCte(w, chain));
        continue;
      }
      const plan = this.compileSelect(w.sel, null, chain);
      const names = w.cols ?? plan.names;
      if (w.cols && w.cols.length !== plan.names.length) {
        throw parseError(`table ${w.name} has ${plan.names.length} values for ${w.cols.length} columns`);
      }
      let cache: Row[] | null = null;
      defs.set(lower(w.name), {
        names,
        cols: plan.cols.map((c, i) => ({ ...c, name: names[i] })),
        rows: () => (cache ??= plan.run(null).map((values, i) => ({ rowid: i + 1, values }))),
      });
    }
    return chain;
  }

  /** WITH RECURSIVE: run the anchor, then feed each new batch of rows back into the rest. */
  private recursiveCte(w: Cte, chain: CteChain): CteDef {
    const name = lower(w.name);
    const anchor = this.compileSelect({ ...w.sel, with: null, cores: [w.sel.cores[0]], ops: [], orderBy: [], limit: null, offset: null }, null, chain);
    const names = w.cols ?? anchor.names;
    if (names.length !== anchor.names.length) throw parseError(`table ${w.name} has ${anchor.names.length} values for ${names.length} columns`);
    let working: Row[] = [];
    let computing = false;
    let cache: Row[] | null = null;
    const def: CteDef = {
      names,
      cols: anchor.cols.map((c, i) => ({ ...c, name: names[i] })),
      rows: () => {
        if (computing) return working;
        if (cache) return cache;
        computing = true;
        try {
          const out: SqlValue[][] = [];
          const seen = new Set<string>();
          const all = w.sel.ops[0] === 'UNION ALL';
          const env = mkEnv(0, null);
          const limit = limitExpr ? Math.trunc(toNumber(limitExpr.ev(env))) : -1;
          let batch = anchor.run(null);
          while (batch.length && (limit < 0 || out.length < limit)) {
            const fresh: SqlValue[][] = [];
            for (const r of batch) {
              if (!all) {
                const k = rowKey(r);
                if (seen.has(k)) continue;
                seen.add(k);
              }
              fresh.push(r);
              out.push(r);
              if (limit >= 0 && out.length >= limit) break;
            }
            if (out.length > 1_000_000) throw runtimeError('too many rows in recursive query');
            working = fresh.map((values, i) => ({ rowid: i + 1, values }));
            batch = rest.run(null);
          }
          cache = out.map((values, i) => ({ rowid: i + 1, values }));
          return cache;
        } finally {
          computing = false;
        }
      },
    };
    chain.defs.set(name, def);
    const rest = this.compileSelect({ ...w.sel, with: null, cores: w.sel.cores.slice(1), ops: w.sel.ops.slice(1), orderBy: [], limit: null, offset: null }, null, chain);
    if (rest.names.length !== names.length) throw parseError(`SELECTs to the left and right of ${w.sel.ops[0]} do not have the same number of result columns`);
    const limitExpr = w.sel.limit ? this.compile(w.sel.limit, newScope(null, null)) : null;
    return def;
  }

  // ---- INSERT ---------------------------------------------------------------------------

  private execInsert(st: Extract<Stmt, { k: 'insert' }>, onResult: (r: SqlResult) => void): void {
    const t = this.targetTable(st.table);
    const chain = this.ctes(st.with, null);
    let targets: number[];
    if (st.cols) {
      targets = st.cols.map((c) => {
        const i = this.colIndex(t, c.name);
        if (i < 0) throw parseError(`table ${t.name} has no column named ${c.name}`, c.pos);
        return i;
      });
    } else {
      targets = t.cols.map((_, i) => i);
    }
    const widthCheck = (width: number) => {
      if (width === targets.length) return;
      if (st.cols) throw parseError(`${width} values for ${targets.length} columns`);
      throw parseError(`table ${t.name} has ${t.cols.length} columns but ${width} values were supplied`);
    };
    let source: () => SqlValue[][];
    if (st.values && st.values.length === 0) {
      targets = [];
      source = () => [[]];
    } else if (st.values) {
      const sc = newScope(null, chain);
      const width = st.values[0].length;
      if (st.values.some((r) => r.length !== width)) throw parseError('all VALUES must have the same number of terms');
      widthCheck(width);
      const compiled = st.values.map((r) => r.map((e) => this.compile(e, sc)));
      source = () => {
        const env = mkEnv(0, null);
        return compiled.map((r) => r.map((c) => c.ev(env)));
      };
    } else {
      const plan = this.compileSelect(st.sel!, null, chain);
      widthCheck(plan.names.length);
      source = () => plan.run(null);
    }
    // ON CONFLICT ... DO UPDATE: the existing row plus "excluded"
    const upserts = st.upsert.map((u) => {
      const target = u.target?.map((n) => {
        const i = this.colIndex(t, n);
        if (i < 0) throw parseError(`no such column: ${n}`);
        return i;
      }) ?? null;
      if (target && !t.uniques.some((x) => x.cols.length === target.length && x.cols.every((c) => target.includes(c))) && !(target.length === 1 && target[0] === t.rowidCol)) {
        throw parseError('ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint');
      }
      if (!u.sets) return { target, sets: null, where: null };
      const sc = newScope(null, chain);
      sc.sources.push(this.tableSource(t, st.alias));
      sc.sources.push({ ...this.tableSource(t, 'excluded') });
      return { target, sets: this.compileSets(u.sets, t, sc), where: u.where ? this.compile(u.where, sc) : null };
    });
    const returning = this.compileReturning(st.returning, t, st.alias);
    this.checkWritable();
    const rows = source();
    const mode = st.or ?? 'ABORT';
    const touched: Row[] = [];
    let n = 0;
    for (const vals of rows) {
      const full: SqlValue[] = new Array(t.cols.length).fill(null);
      const given = new Array(t.cols.length).fill(false);
      targets.forEach((ti, j) => {
        full[ti] = applyAffinity(vals[j], t.cols[ti].aff);
        given[ti] = true;
      });
      for (let i = 0; i < t.cols.length; i++) if (!given[i]) full[i] = this.defaultValue(t, i);
      if (!this.notNullOk(t, full, mode)) continue;
      let rowid: number;
      if (t.rowidCol >= 0 && full[t.rowidCol] !== null) {
        const v = full[t.rowidCol];
        if (typeof v !== 'number' || !Number.isInteger(v)) throw runtimeError('datatype mismatch', 20);
        rowid = v;
      } else {
        rowid = this.nextRowid(t);
        if (t.rowidCol >= 0) full[t.rowidCol] = rowid;
      }
      const conflicts = this.conflicts(t, full, rowid, null);
      if (conflicts.length) {
        const c = conflicts[0];
        const up = upserts.find((u) => u.target === null || (u.target.length === c.cols.length && u.target.every((x) => c.cols.includes(x))));
        if (up) {
          if (!up.sets) continue;
          const env = mkEnv(2, null);
          env.rows[0] = c.row.values;
          env.rowids[0] = c.row.rowid;
          env.rows[1] = full;
          env.rowids[1] = rowid;
          if (up.where && !isTrue(up.where.ev(env))) continue;
          const nv = c.row.values.slice();
          for (const s of up.sets) nv[s.ci] = applyAffinity(s.c.ev(env), t.cols[s.ci].aff);
          const updated = this.updateOne(t, c.row, nv, 'ABORT');
          if (updated) {
            touched.push(updated);
            n++;
          }
          continue;
        }
        if (mode === 'IGNORE') continue;
        if (mode !== 'REPLACE') throw runtimeError(`UNIQUE constraint failed: ${c.label}`, 19);
        this.deleteRows(t, new Set(conflicts.map((x) => x.row)));
      }
      const row = { rowid, values: full };
      this.addRow(t, row);
      this.bumpSeq(t, rowid);
      this.lastRowid = rowid;
      touched.push(row);
      n++;
    }
    this.changesN = n;
    this.totalChangesN += n;
    if (returning) onResult({ columns: returning.names, rows: this.returningRows(returning, touched) });
  }

  /** NOT NULL checks. Returns false when the row is to be skipped (OR IGNORE). */
  private notNullOk(t: Table, vals: SqlValue[], mode: string): boolean {
    for (let i = 0; i < t.cols.length; i++) {
      const c = t.cols[i];
      if (!c.notNull || vals[i] !== null || i === t.rowidCol) continue;
      if (mode === 'IGNORE') return false;
      if (mode === 'REPLACE' && c.dflt) {
        vals[i] = this.defaultValue(t, i);
        if (vals[i] !== null) continue;
      }
      throw runtimeError(`NOT NULL constraint failed: ${t.name}.${c.name}`, 19);
    }
    return true;
  }

  private conflicts(t: Table, vals: SqlValue[], rowid: number, self: Row | null): { row: Row; label: string; cols: number[] }[] {
    const out: { row: Row; label: string; cols: number[] }[] = [];
    const r = this.findRowid(t, rowid);
    if (r && r !== self) {
      out.push({ row: r, label: t.rowidCol >= 0 ? `${t.name}.${t.cols[t.rowidCol].name}` : `${t.name}.rowid`, cols: [t.rowidCol] });
    }
    for (const u of t.uniques) {
      const k = this.ukey(t, u, vals);
      if (k === null) continue;
      const o = u.map.get(k);
      if (o && o !== self && !out.some((x) => x.row === o && x.cols === u.cols)) {
        out.push({ row: o, label: u.cols.map((c) => `${t.name}.${t.cols[c].name}`).join(', '), cols: u.cols });
      }
    }
    return out;
  }

  /** Replace one row's values, enforcing constraints. Returns the new row, or null if skipped. */
  private updateOne(t: Table, old: Row, nv: SqlValue[], mode: string): Row | null {
    if (this.findRowid(t, old.rowid) !== old) return null; // removed by an earlier REPLACE
    if (!this.notNullOk(t, nv, mode)) return null;
    let rowid = old.rowid;
    if (t.rowidCol >= 0) {
      const v = nv[t.rowidCol];
      if (typeof v !== 'number' || !Number.isInteger(v)) throw runtimeError('datatype mismatch', 20);
      rowid = v;
    }
    const conflicts = this.conflicts(t, nv, rowid, old);
    if (conflicts.length) {
      if (mode === 'IGNORE') return null;
      if (mode !== 'REPLACE') throw runtimeError(`UNIQUE constraint failed: ${conflicts[0].label}`, 19);
      this.deleteRows(t, new Set(conflicts.map((x) => x.row)));
    }
    const row = { rowid, values: nv };
    this.replaceRow(t, old, row);
    return row;
  }

  private compileSets(sets: SetClause[], t: Table, sc: Scope): { ci: number; c: CExpr }[] {
    return sets.map((s) => {
      const col = s.cols[0];
      const ci = this.colIndex(t, col.name);
      if (ci < 0) throw parseError(`no such column: ${col.name}`, col.pos);
      return { ci, c: this.compile(s.e, sc) };
    });
  }

  // ---- UPDATE / DELETE ------------------------------------------------------------------

  private execUpdate(st: Extract<Stmt, { k: 'update' }>, onResult: (r: SqlResult) => void): void {
    const t = this.targetTable(st.table);
    const sc = newScope(null, this.ctes(st.with, null));
    sc.sources.push(this.tableSource(t, st.alias));
    for (const item of st.from) this.addSource(sc, item);
    const sets = this.compileSets(st.sets, t, sc);
    const where = st.where ? this.compile(st.where, sc) : null;
    const returning = this.compileReturning(st.returning, t, st.alias);
    this.checkWritable();
    const pending: [Row, SqlValue[]][] = [];
    const env = mkEnv(sc.sources.length, null);
    for (const row of t.rows.slice()) {
      env.rows[0] = row.values;
      env.rowids[0] = row.rowid;
      let found = false;
      this.loopJoin(sc.sources, env, 1, () => {
        if (found || (where && !isTrue(where.ev(env)))) return;
        found = true;
        const nv = row.values.slice();
        for (const s of sets) nv[s.ci] = applyAffinity(s.c.ev(env), t.cols[s.ci].aff);
        pending.push([row, nv]);
      });
    }
    const touched: Row[] = [];
    const mode = st.or ?? 'ABORT';
    for (const [old, nv] of pending) {
      const row = this.updateOne(t, old, nv, mode);
      if (row) touched.push(row);
    }
    this.changesN = touched.length;
    this.totalChangesN += touched.length;
    if (returning) onResult({ columns: returning.names, rows: this.returningRows(returning, touched) });
  }

  private execDelete(st: Extract<Stmt, { k: 'delete' }>, onResult: (r: SqlResult) => void): void {
    const t = this.targetTable(st.table);
    const sc = newScope(null, this.ctes(st.with, null));
    sc.sources.push(this.tableSource(t, st.alias));
    const where = st.where ? this.compile(st.where, sc) : null;
    const returning = this.compileReturning(st.returning, t, st.alias);
    this.checkWritable();
    const dead = new Set<Row>();
    const env = mkEnv(1, null);
    for (const row of t.rows) {
      env.rows[0] = row.values;
      env.rowids[0] = row.rowid;
      if (!where || isTrue(where.ev(env))) dead.add(row);
    }
    const out = returning ? this.returningRows(returning, [...dead]) : null;
    this.deleteRows(t, dead);
    this.changesN = dead.size;
    this.totalChangesN += dead.size;
    if (returning) onResult({ columns: returning.names, rows: out! });
  }

  // ---- DDL ------------------------------------------------------------------------------

  private checkNewName(tn: TableName, ifNot: boolean, what: 'table' | 'index' | 'view'): boolean {
    this.checkSchema(tn);
    const existing = this.findObj(tn.name);
    if (existing || this.isMaster(tn.name)) {
      if (ifNot) return false;
      if (what === 'index') {
        if (existing?.kind === 'index') throw parseError(`index ${tn.name} already exists`, tn.pos);
        throw parseError(`there is already a table named ${tn.name}`, tn.pos);
      }
      if (existing?.kind === 'index') throw parseError(`there is already an index named ${tn.name}`, tn.pos);
      throw parseError(`${existing?.kind === 'view' ? 'view' : 'table'} ${tn.name} already exists`, tn.pos);
    }
    if (lower(tn.name).startsWith('sqlite_')) throw parseError(`object name reserved for internal use: ${tn.name}`, tn.pos);
    return true;
  }

  private execCreateTable(st: Extract<Stmt, { k: 'createTable' }>): void {
    if (!this.checkNewName(st.table, st.ifNot, 'table')) return;
    const name = st.table.name;
    let rows: SqlValue[][] = [];
    let sql = st.sql;
    if (st.asSel) {
      const plan = this.compileSelect(st.asSel, null, null);
      const used = new Set<string>();
      const defs = plan.names.map((n, i) => {
        let nm = n;
        for (let k = 1; used.has(lower(nm)); k++) nm = `${n}:${k}`;
        used.add(lower(nm));
        const aff = plan.cols[i].aff;
        const type = aff === 'INTEGER' ? ' INT' : aff === 'TEXT' ? ' TEXT' : aff === 'REAL' ? ' REAL' : aff === 'NUMERIC' ? ' NUM' : '';
        return `\n  ${quoteIdent(nm)}${type}`;
      });
      sql = `CREATE TABLE ${quoteIdent(name)}(${defs.join(',')}\n)`;
      this.checkWritable();
      rows = plan.run(null);
    }
    const t = this.buildTable(name, sql);
    this.checkWritable();
    const objs = [...this.objects, t];
    if (t.autoinc && !this.findTable('sqlite_sequence')) objs.push(this.buildTable('sqlite_sequence', SEQ_SQL));
    this.setObjects(objs);
    rows.forEach((vals, i) => this.addRow(t, { rowid: i + 1, values: vals.map((v, j) => applyAffinity(v, t.cols[j].aff)) }));
  }

  private execCreateIndex(st: Extract<Stmt, { k: 'createIndex' }>): void {
    if (!this.checkNewName(st.name, st.ifNot, 'index')) return;
    this.checkSchema(st.table);
    if (this.isMaster(st.table.name)) throw parseError(`table ${st.table.name} may not be indexed`, st.table.pos);
    const o = this.findObj(st.table.name);
    if (!o || o.kind === 'index') throw parseError(`no such table: main.${st.table.name}`, st.table.pos);
    if (o.kind === 'view') throw parseError('views may not be indexed', st.table.pos);
    const t = o;
    const sc = newScope(null, null);
    sc.sources.push(this.tableSource(t, null));
    const cols = st.cols.map(({ e }) => {
      let inner = e;
      while (inner.k === 'collate') inner = inner.e;
      if (inner.k === 'col' && !inner.tbl) {
        const i = this.colIndex(t, inner.name);
        if (i < 0) throw parseError(`no such column: ${inner.name}`, inner.pos);
        return i;
      }
      this.compile(e, sc);
      return null;
    });
    if (st.where) this.compile(st.where, sc);
    this.checkWritable();
    const idx: Index = { kind: 'index', name: st.name.name, tblName: t.name, sql: st.sql, unique: st.unique, cols, partial: !!st.where };
    if (st.unique && !st.where && cols.every((c) => c !== null)) {
      const u: UniqueIdx = { cols: cols as number[], map: new Map(), index: idx.name };
      this.fillUnique(t, u);
      t.uniques.push(u);
      this.log(() => {
        t.uniques = t.uniques.filter((x) => x !== u);
      });
    }
    this.setObjects([...this.objects, idx]);
  }

  private execCreateView(st: Extract<Stmt, { k: 'createView' }>): void {
    if (!this.checkNewName(st.name, st.ifNot, 'view')) return;
    const plan = this.compileSelect(st.sel, null, null);
    if (st.cols && st.cols.length !== plan.names.length) {
      throw parseError(`expected ${st.cols.length} columns for '${st.name.name}' but got ${plan.names.length}`);
    }
    this.checkWritable();
    this.setObjects([...this.objects, { kind: 'view', name: st.name.name, sql: st.sql }]);
  }

  private execDrop(st: Extract<Stmt, { k: 'drop' }>): void {
    const tn = st.name;
    this.checkSchema(tn);
    if (this.isMaster(tn.name)) throw parseError(`table ${tn.name} may not be dropped`, tn.pos);
    const o = this.findObj(tn.name);
    const what = lower(st.what);
    if (!o || (o.kind !== what && !(o.kind === 'view' && what === 'table') && !(o.kind === 'table' && what === 'view'))) {
      if (st.ifExists) return;
      throw parseError(`no such ${what}: ${tn.schema ? tn.schema + '.' : ''}${tn.name}`, tn.pos);
    }
    if (o.kind === 'view' && what === 'table') throw parseError(`use DROP VIEW to delete view ${o.name}`, tn.pos);
    if (o.kind === 'table' && what === 'view') throw parseError(`use DROP TABLE to delete table ${o.name}`, tn.pos);
    if (o.kind === 'table' && lower(o.name) === 'sqlite_sequence') throw parseError(`table ${o.name} may not be dropped`, tn.pos);
    this.checkWritable();
    if (o.kind === 'index') {
      const t = this.findTable(o.tblName);
      if (t) {
        const before = t.uniques;
        t.uniques = before.filter((u) => u.index !== o.name);
        this.log(() => {
          t.uniques = before;
        });
      }
      this.setObjects(this.objects.filter((x) => x !== o));
      return;
    }
    const n = lower(o.name);
    this.setObjects(this.objects.filter((x) => x !== o && !(x.kind === 'index' && lower(x.tblName) === n)));
    if (o.kind === 'table' && o.autoinc) {
      const seq = this.findTable('sqlite_sequence');
      const r = this.seqRow(o.name);
      if (seq && r) this.deleteRows(seq, new Set([r]));
    }
  }

  /** Swap a table for a rebuilt one (new SQL, mapped rows), along with its indexes. */
  private rebuildTable(t: Table, name: string, sql: string, mapRow: (v: SqlValue[]) => SqlValue[], mapIndexSql: (sql: string) => string, dropped = -1): Table {
    const nt = this.buildTable(name, sql);
    nt.rows = t.rows.map((r) => ({ rowid: r.rowid, values: mapRow(r.values) }));
    for (const u of nt.uniques) this.fillUnique(nt, u);
    const objs: SchemaObj[] = this.objects.map((o) => {
      if (o === t) return nt;
      if (o.kind === 'index' && lower(o.tblName) === lower(t.name)) {
        const cols = o.cols.map((c) => (c === null ? null : dropped >= 0 && c > dropped ? c - 1 : c));
        const idx: Index = { ...o, tblName: name, sql: mapIndexSql(o.sql), cols };
        const old = t.uniques.find((u) => u.index === o.name);
        if (old) {
          const u: UniqueIdx = { cols: cols as number[], map: new Map(), index: o.name };
          this.fillUnique(nt, u);
          nt.uniques.push(u);
        }
        return idx;
      }
      return o;
    });
    this.setObjects(objs);
    return nt;
  }

  private execAlter(st: Extract<Stmt, { k: 'alter' }>): void {
    const tn = st.table;
    this.checkSchema(tn);
    const o = this.findObj(tn.name);
    if (!o || o.kind !== 'table') {
      if (o?.kind === 'view') throw parseError(`cannot modify ${o.name} because it is a view`, tn.pos);
      throw parseError(`no such table: ${tn.name}`, tn.pos);
    }
    const t = o;
    if (lower(t.name).startsWith('sqlite_')) throw parseError(`table ${t.name} may not be altered`, tn.pos);
    const a = st.action;
    const nameTok = lex(t.sql, 'CREATE TABLE'.length);
    switch (a.k) {
      case 'rename': {
        const clash = this.findObj(a.to);
        if ((clash && clash !== t) || this.isMaster(a.to)) throw parseError(`there is already another table or index with this name: ${a.to}`);
        if (lower(a.to).startsWith('sqlite_')) throw parseError(`object name reserved for internal use: ${a.to}`);
        this.checkWritable();
        const quoted = '"' + a.to.replace(/"/g, '""') + '"';
        const sql = t.sql.slice(0, nameTok.start) + quoted + t.sql.slice(nameTok.end);
        const renameOn = (isql: string) => {
          const p = new IndexSqlEditor(isql);
          return p.replaceTable(quoted);
        };
        this.rebuildTable(t, a.to, sql, (v) => v, renameOn);
        if (t.autoinc) {
          const seq = this.findTable('sqlite_sequence');
          const r = this.seqRow(t.name);
          if (seq && r) this.replaceRow(seq, r, { rowid: r.rowid, values: [a.to, r.values[1]] });
        }
        return;
      }
      case 'renameCol': {
        const ci = this.colIndex(t, a.from);
        if (ci < 0 || lower(t.cols[ci].name) !== lower(a.from)) throw parseError(`no such column: "${a.from}"`);
        if (t.cols.some((c, i) => i !== ci && lower(c.name) === lower(a.to))) throw parseError(`duplicate column name: ${a.to}`);
        this.checkWritable();
        const edits: [number, number][] = [[t.def.cols[ci].nameStart, t.def.cols[ci].nameEnd]];
        for (const k of t.def.constraints) for (const r of k.cols) if (lower(r.name) === lower(a.from)) edits.push([r.start, r.end]);
        edits.sort((x, y) => y[0] - x[0]);
        let sql = t.sql;
        for (const [s, e] of edits) {
          const origQuoted = /^["`[]/.test(sql.slice(s, e));
          const rep = a.toQuoted || origQuoted ? '"' + a.to.replace(/"/g, '""') + '"' : a.to;
          sql = sql.slice(0, s) + rep + sql.slice(e);
        }
        const renameIdxCol = (isql: string) => new IndexSqlEditor(isql).replaceColumn(a.from, a.to);
        this.rebuildTable(t, t.name, sql, (v) => v, renameIdxCol);
        return;
      }
      case 'add': {
        const def = parseColumnDef(a.text);
        if (t.cols.some((c) => lower(c.name) === lower(def.name))) throw parseError(`duplicate column name: ${def.name}`);
        if (def.pk) throw parseError('Cannot add a PRIMARY KEY column');
        if (def.unique) throw parseError('Cannot add a UNIQUE column');
        if (def.dflt && (def.dflt.k === 'ctime' || (def.dflt.k !== 'lit' && hasNonConst(def.dflt)))) {
          throw runtimeError('Cannot add a column with non-constant default');
        }
        let dv: SqlValue = null;
        if (def.dflt) dv = this.compile(def.dflt, newScope(null, null)).ev(mkEnv(0, null));
        if (def.notNull && dv === null) throw runtimeError('Cannot add a NOT NULL column with default value NULL');
        this.checkWritable();
        const close = t.def.close;
        const sql = t.sql.slice(0, close) + ', ' + a.text + t.sql.slice(close);
        const aff = affinityOf(def.type);
        this.rebuildTable(t, t.name, sql, (v) => [...v, applyAffinity(dv, aff)], (s) => s);
        return;
      }
      case 'dropCol': {
        const ci = this.colIndex(t, a.name);
        if (ci < 0 || lower(t.cols[ci].name) !== lower(a.name)) throw parseError(`no such column: "${a.name}"`);
        const c = t.cols[ci];
        if (c.pk) throw parseError(`cannot drop PRIMARY KEY column: "${c.name}"`);
        if (t.uniques.some((u) => u.index === null && u.cols.includes(ci))) throw parseError(`cannot drop UNIQUE column: "${c.name}"`);
        if (t.cols.length === 1) throw parseError(`cannot drop column "${c.name}": no other columns exist`);
        for (const x of this.objects) {
          if (x.kind === 'index' && lower(x.tblName) === lower(t.name) && x.cols.includes(ci)) {
            throw parseError(`error in index ${x.name} after drop column: no such column: ${c.name}`);
          }
        }
        this.checkWritable();
        const d = t.def.cols;
        const sql = ci > 0 ? t.sql.slice(0, d[ci - 1].end) + t.sql.slice(d[ci].end) : t.sql.slice(0, d[0].start) + t.sql.slice(d[1].start);
        this.rebuildTable(t, t.name, sql, (v) => v.filter((_, i) => i !== ci), (s) => s, ci);
        return;
      }
    }
  }

  // ---- PRAGMA ---------------------------------------------------------------------------

  private execPragma(st: Extract<Stmt, { k: 'pragma' }>, onResult: (r: SqlResult) => void): void {
    const name = lower(st.name);
    const res = (columns: string[], rows: SqlValue[][]) => onResult({ columns, rows });
    const pr = this.pragmaRows(name, st.arg);
    if (pr) {
      res(pr.columns, pr.rows);
      return;
    }
    if (st.arg !== null) return; // settings are accepted and ignored
    switch (name) {
      case 'foreign_keys':
      case 'user_version':
      case 'schema_version':
      case 'application_id':
      case 'recursive_triggers':
        return res([name], [[0]]);
      case 'journal_mode':
        return res([name], [['delete']]);
      case 'encoding':
        return res([name], [['UTF-8']]);
      case 'page_size':
        return res([name], [[4096]]);
      case 'integrity_check':
      case 'quick_check':
        return res([name], [['ok']]);
      case 'database_list':
        return res(['seq', 'name', 'file'], [[0, 'main', '']]);
      case 'table_list':
        return res(['schema', 'name', 'type', 'ncol', 'wr', 'strict'], this.objects.filter((o) => o.kind !== 'index').map((o) => [
          'main', o.name, o.kind, o.kind === 'table' ? o.cols.length : 0, 0, 0,
        ]));
      default:
        return;
    }
  }

  /** PRAGMA functions that take a table or index name; also used as table-valued functions. */
  private pragmaRows(name: string, arg: string | null): SqlResult | null {
    switch (name) {
      case 'table_info':
      case 'table_xinfo': {
        const columns = ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];
        if (name === 'table_xinfo') columns.push('hidden');
        if (arg === null) return null;
        const t = this.findTable(arg);
        if (t) {
          return {
            columns,
            rows: t.cols.map((c, i) => {
              const r: SqlValue[] = [i, c.name, c.type, c.notNull ? 1 : 0, c.dfltText, c.pk];
              if (name === 'table_xinfo') r.push(0);
              return r;
            }),
          };
        }
        const v = this.findObj(arg);
        if (v && v.kind === 'view') {
          const plan = this.viewPlan(v);
          return { columns, rows: plan.names.map((n, i) => [i, n, '', 0, null, 0]) };
        }
        if (this.isMaster(arg)) return { columns, rows: MASTER_COLS.map((n, i) => [i, n, n === 'rootpage' ? 'INT' : 'TEXT', 0, null, 0]) };
        return { columns, rows: [] };
      }
      case 'index_list': {
        if (arg === null) return null;
        const t = this.findTable(arg);
        const rows: SqlValue[][] = [];
        if (t) {
          const idx = this.objects.filter((o): o is Index => o.kind === 'index' && lower(o.tblName) === lower(t.name));
          idx.reverse().forEach((o) => rows.push([0, o.name, o.unique ? 1 : 0, 'c', o.partial ? 1 : 0]));
          let k = t.uniques.filter((u) => u.index === null).length;
          for (const u of [...t.uniques].reverse()) {
            if (u.index !== null) continue;
            const isPk = u.cols.length > 0 && u.cols.every((c) => t.cols[c].pk > 0) && u.cols.length === t.cols.filter((c) => c.pk > 0).length;
            rows.push([0, `sqlite_autoindex_${t.name}_${k--}`, 1, isPk ? 'pk' : 'u', 0]);
          }
          rows.forEach((r, i) => (r[0] = i));
        }
        return { columns: ['seq', 'name', 'unique', 'origin', 'partial'], rows };
      }
      case 'index_info': {
        if (arg === null) return null;
        const o = this.findObj(arg);
        const rows: SqlValue[][] = [];
        if (o && o.kind === 'index') {
          const t = this.findTable(o.tblName);
          o.cols.forEach((c, i) => rows.push([i, c ?? -2, c === null || !t ? null : t.cols[c].name]));
        }
        return { columns: ['seqno', 'cid', 'name'], rows };
      }
      default:
        return null;
    }
  }

  // ---- SELECT ---------------------------------------------------------------------------

  private viewPlan(v: View): Plan {
    const { cols, sel } = parseViewSelect(v.sql);
    const plan = this.compileSelect(sel, null, null);
    if (cols) return { ...plan, names: cols, cols: plan.cols.map((c, i) => ({ ...c, name: cols[i] ?? c.name })) };
    return plan;
  }

  private masterRows(): Row[] {
    const out: Row[] = [];
    let page = 2;
    for (const o of this.objects) {
      if (o.kind === 'table') {
        out.push({ rowid: out.length + 1, values: ['table', o.name, o.name, page++, o.sql] });
        let k = 0;
        for (const u of o.uniques) {
          if (u.index === null) out.push({ rowid: out.length + 1, values: ['index', `sqlite_autoindex_${o.name}_${++k}`, o.name, page++, null] });
        }
      } else if (o.kind === 'index') {
        out.push({ rowid: out.length + 1, values: ['index', o.name, o.tblName, page++, o.sql] });
      } else {
        out.push({ rowid: out.length + 1, values: ['view', o.name, o.name, 0, o.sql] });
      }
    }
    return out;
  }

  private addSource(sc: Scope, item: FromItem): void {
    let src: Source;
    const textCol = (name: string, aff: Aff = null): SrcCol => ({ name, aff, coll: null, real: false, hidden: false });
    switch (item.src.k) {
      case 'table': {
        const tn = item.src.t;
        this.checkSchema(tn);
        const n = lower(tn.name);
        let cte: CteDef | null = null;
        for (let c = tn.schema ? null : sc.ctes; c && !cte; c = c.up) cte = c.defs.get(n) ?? null;
        if (cte) {
          const def = cte;
          src = { name: lower(item.alias ?? tn.name), cols: def.cols.map((c) => ({ ...c, hidden: false })), rowid: false, rows: () => def.rows(), on: null, left: false, probe: null };
          break;
        }
        if (this.isMaster(tn.name)) {
          src = {
            name: lower(item.alias ?? tn.name),
            cols: MASTER_COLS.map((c) => textCol(c, c === 'rootpage' ? 'INTEGER' : 'TEXT')),
            rowid: true,
            rows: () => this.masterRows(),
            on: null,
            left: false,
            probe: null,
          };
          break;
        }
        const o = this.findObj(tn.name);
        if (!o || o.kind === 'index') throw parseError(`no such table: ${tn.schema ? tn.schema + '.' : ''}${tn.name}`, tn.pos);
        if (o.kind === 'table') {
          src = this.tableSource(o, item.alias);
          break;
        }
        const plan = this.viewPlan(o);
        let cache: Row[] | null = null;
        src = {
          name: lower(item.alias ?? o.name),
          cols: plan.cols.map((c) => ({ ...c, hidden: false })),
          rowid: false,
          rows: () => (cache ??= plan.run(null).map((values, i) => ({ rowid: i + 1, values }))),
          on: null,
          left: false,
          probe: null,
        };
        break;
      }
      case 'sub': {
        const plan = this.compileSelect(item.src.sel, sc.parent, sc.ctes);
        if (plan.correlated) sc.correlated = true;
        let cache: Row[] | null = null;
        const toRows = (vals: SqlValue[][]) => vals.map((values, i) => ({ rowid: i + 1, values }));
        src = {
          name: lower(item.alias ?? ''),
          cols: plan.cols.map((c) => ({ ...c, hidden: false })),
          rowid: false,
          rows: plan.correlated ? (env) => toRows(plan.run(env.parent)) : () => (cache ??= toRows(plan.run(null))),
          on: null,
          left: false,
          probe: null,
        };
        break;
      }
      case 'tvf': {
        const fname = lower(item.src.name);
        const m = /^pragma_(.+)$/.exec(fname);
        const argSc = newScope(null, null);
        const args = item.src.args.map((e) => this.compile(e, argSc));
        const probe = m ? this.pragmaRows(m[1], '') : null;
        if (!m || !probe) throw parseError(`no such table: ${item.src.name}`, item.src.pos);
        const pname = m[1];
        src = {
          name: lower(item.alias ?? item.src.name),
          cols: probe.columns.map((c) => textCol(c)),
          rowid: false,
          rows: () => {
            const a = args.length ? toText(args[0].ev(mkEnv(0, null))) : null;
            return (this.pragmaRows(pname, a ?? '')?.rows ?? []).map((values, i) => ({ rowid: i + 1, values }));
          },
          on: null,
          left: false,
          probe: null,
        };
        break;
      }
    }
    src.left = item.join === 'left';
    const prior = sc.sources.slice();
    sc.sources.push(src);
    const conds: CExpr[] = [];
    let using = item.using;
    if (item.natural) {
      using = src.cols.filter((c) => prior.some((p) => p.cols.some((pc) => !pc.hidden && lower(pc.name) === lower(c.name)))).map((c) => c.name);
    }
    if (using) {
      for (const name of using) {
        const ri = src.cols.findIndex((c) => lower(c.name) === lower(name));
        const li = prior.findIndex((p) => p.cols.some((c) => !c.hidden && lower(c.name) === lower(name)));
        if (ri < 0 || li < 0) throw parseError(`cannot join using column ${name} - column not present in both tables`);
        const lci = prior[li].cols.findIndex((c) => !c.hidden && lower(c.name) === lower(name));
        src.cols[ri] = { ...src.cols[ri], hidden: true };
        const si = sc.sources.length - 1;
        const l = cexpr((env) => env.rows[li]?.[lci] ?? null, { aff: prior[li].cols[lci].aff });
        const r = cexpr((env) => env.rows[si]?.[ri] ?? null, { aff: src.cols[ri].aff });
        conds.push(this.comparison('=', l, r));
        src.probe ??= { ci: ri, key: l, aff: comparisonAffinity(src.cols[ri].aff, l.aff), coll: null, cache: { rows: null, map: new Map() } };
      }
    }
    if (item.on) {
      this.addProbes(sc, item.on, sc.sources.length - 1);
      conds.push(this.compile(item.on, sc));
    }
    if (conds.length === 1) src.on = conds[0];
    else if (conds.length > 1) src.on = cexpr((env) => (conds.every((c) => isTrue(c.ev(env))) ? 1 : 0));
  }

  /** Find `col = key` terms usable as hash lookups; `only` limits them to one source (for ON). */
  private addProbes(sc: Scope, cond: Expr, only: number | null): void {
    for (const c of conjuncts(cond)) {
      if (c.k !== 'bin' || c.op !== '=') continue;
      for (const [a, b] of [[c.l, c.r], [c.r, c.l]]) {
        if (a.k !== 'col') continue;
        const deps = new Set<number>();
        const prev = sc.track;
        let ca: CExpr;
        let cb: CExpr;
        try {
          sc.track = null;
          ca = this.compile(a, sc);
          sc.track = deps;
          cb = this.compile(b, sc);
        } catch (e) {
          if (e instanceof SqlError) continue;
          throw e;
        } finally {
          sc.track = prev;
        }
        if (!ca.src) continue;
        const [k, ci] = ca.src;
        const src = sc.sources[k];
        if ((only !== null && k !== only) || src.probe || (only === null && src.left)) continue;
        if ([...deps].some((d) => d >= k)) continue;
        const coll = ca.collX ? ca.coll : cb.collX ? cb.coll : (ca.coll ?? cb.coll);
        src.probe = { ci, key: cb, aff: comparisonAffinity(ca.aff, cb.aff), coll, cache: { rows: null, map: new Map() } };
        break;
      }
    }
  }

  /** Visit every combination of source rows from `start`, honouring ON and LEFT JOIN. */
  private loopJoin(sources: Source[], env: Env, start: number, visit: () => void): void {
    const n = sources.length;
    const step = (i: number): void => {
      if (i === n) {
        visit();
        return;
      }
      const s = sources[i];
      let rows = s.rows(env);
      if (s.probe) rows = probeRows(s.probe, rows, s.probe.key.ev(env));
      let matched = false;
      for (let k = 0; k < rows.length; k++) {
        // Like sqlite3_interrupt: a statement that would run for minutes stops instead, because this
        // engine shares one thread with every player's game.
        if (++this.work > WORK_LIMIT) throw runtimeError('interrupted', 9);
        const r = rows[k];
        env.rows[i] = r.values;
        env.rowids[i] = r.rowid;
        if (s.on !== null && !isTrue(s.on.ev(env))) continue;
        matched = true;
        step(i + 1);
      }
      if (!matched && s.left) {
        env.rows[i] = null;
        env.rowids[i] = null;
        step(i + 1);
      }
    };
    step(start);
  }

  /** Expand `*` and compile a result-column list. */
  private resultList(cols: ResultCol[], sc: Scope): { names: string[]; exprs: CExpr[]; items: { e: Expr | null; alias: string | null; span: string }[] } {
    const items: { e: Expr | null; alias: string | null; span: string; direct?: [number, number] }[] = [];
    for (const rc of cols) {
      if (rc.k === 'star') {
        if (sc.sources.length === 0) throw parseError('no tables specified', rc.pos);
        let any = false;
        sc.sources.forEach((s, si) => {
          if (rc.tbl !== null && s.name !== lower(rc.tbl)) return;
          any = true;
          s.cols.forEach((c, ci) => {
            if (!c.hidden || rc.tbl !== null) items.push({ e: null, alias: null, span: c.name, direct: [si, ci] });
          });
        });
        if (!any) throw parseError(`no such table: ${rc.tbl}`, rc.pos);
        continue;
      }
      items.push({ e: rc.e, alias: rc.alias, span: rc.span });
    }
    const exprs: CExpr[] = [];
    const names: string[] = [];
    for (const it of items) {
      if (it.direct) {
        const [si, ci] = it.direct;
        const c = sc.sources[si].cols[ci];
        exprs.push(cexpr((env) => env.rows[si]?.[ci] ?? null, { aff: c.aff, coll: c.coll, real: c.real, colName: c.name }));
        names.push(c.name);
        continue;
      }
      const c = this.compile(it.e!, sc);
      exprs.push(c);
      names.push(it.alias ?? c.colName ?? it.span);
    }
    return { names, exprs, items };
  }

  private compileSelect(sel: Select, parent: Scope | null, ctesIn: CteChain | null): Plan {
    const chain = this.ctes(sel.with, ctesIn);
    const single = sel.cores.length === 1 && sel.cores[0].k === 'core';
    const cores = sel.cores.map((c) => this.compileCore(c, parent, chain, single ? sel.orderBy : null));
    const first = cores[0];
    for (let i = 1; i < cores.length; i++) {
      if (cores[i].names.length !== first.names.length) {
        throw parseError(`SELECTs to the left and right of ${sel.ops[i - 1]} do not have the same number of result columns`);
      }
    }
    const limSc = newScope(parent, chain);
    const limit = sel.limit ? this.compile(sel.limit, limSc) : null;
    const offset = sel.offset ? this.compile(sel.offset, limSc) : null;
    let orderIdx: { idx: number; desc: boolean; nulls: OrderTerm['nulls']; coll: Collation | null }[] | null = null;
    if (!single && sel.orderBy.length) {
      orderIdx = sel.orderBy.map((t, n) => {
        let e = t.e;
        let coll: Collation | null = null;
        if (e.k === 'collate') {
          coll = collationOf(e.coll);
          e = e.e;
        }
        let idx = -1;
        if (e.k === 'lit' && typeof e.v === 'number' && Number.isInteger(e.v)) {
          idx = e.v - 1;
          if (idx < 0 || idx >= first.names.length) throw parseError(`${ordinal(n + 1)} ORDER BY term out of range - should be between 1 and ${first.names.length}`);
        } else if (e.k === 'col') {
          idx = first.names.findIndex((nm) => lower(nm) === lower(e.k === 'col' ? e.name : ''));
        }
        if (idx < 0) throw parseError(`${ordinal(n + 1)} ORDER BY term does not match any column in the result set`);
        return { idx, desc: t.desc, nulls: t.nulls, coll: coll ?? first.cols[idx].coll };
      });
    }
    const correlated = cores.some((c) => c.correlated) || limSc.correlated;
    const run = (penv: Env | null): SqlValue[][] => {
      let rows: OutRow[];
      if (single) {
        rows = cores[0].run(penv);
        if (cores[0].order) sortRows(rows, cores[0].order);
      } else {
        rows = cores[0].run(penv);
        for (let i = 1; i < cores.length; i++) {
          const next = cores[i].run(penv);
          const op = sel.ops[i - 1];
          if (op === 'UNION ALL') {
            rows = rows.concat(next);
            continue;
          }
          const nextKeys = new Set(next.map((r) => rowKey(r.vals)));
          if (op === 'UNION') rows = dedupe(rows.concat(next));
          else if (op === 'INTERSECT') rows = dedupe(rows).filter((r) => nextKeys.has(rowKey(r.vals)));
          else rows = dedupe(rows).filter((r) => !nextKeys.has(rowKey(r.vals)));
          rows.sort((a, b) => compareRows(a.vals, b.vals));
        }
        if (orderIdx) {
          for (const r of rows) r.keys = orderIdx.map((o) => r.vals[o.idx]);
          sortRows(rows, orderIdx);
        }
      }
      let out = rows.map((r) => r.vals);
      if (limit || offset) {
        const env = mkEnv(0, penv);
        const num = (c: CExpr) => {
          const v = c.ev(env);
          const [n, isInt] = numInfo(v);
          if (v === null || !isInt || (typeof v === 'string' && !/^\s*[+-]?\d+\s*$/.test(v))) throw runtimeError('datatype mismatch', 20);
          return n;
        };
        const off = offset ? Math.max(0, num(offset)) : 0;
        const lim = limit ? num(limit) : -1;
        out = out.slice(off, lim < 0 ? undefined : off + lim);
      }
      return out;
    };
    return { names: first.names, cols: first.cols, run, correlated };
  }

  private compileCore(core: Core, parent: Scope | null, ctes: CteChain | null, order: OrderTerm[] | null): {
    names: string[];
    cols: SrcCol[];
    run: (penv: Env | null) => OutRow[];
    correlated: boolean;
    order: { desc: boolean; nulls: OrderTerm['nulls']; coll: Collation | null }[] | null;
  } {
    const sc = newScope(parent, ctes);
    if (core.k === 'values') {
      const width = core.rows[0].length;
      if (core.rows.some((r) => r.length !== width)) throw parseError('all VALUES must have the same number of terms');
      const rows = core.rows.map((r) => r.map((e) => this.compile(e, sc)));
      const names = Array.from({ length: width }, (_, i) => `column${i + 1}`);
      return {
        names,
        cols: names.map((name, i) => ({ name, aff: null, coll: null, real: rows[0][i].real, hidden: false })),
        run: (penv) => {
          const env = mkEnv(0, penv);
          return rows.map((r) => ({ vals: r.map((c) => c.ev(env)), keys: null }));
        },
        get correlated() {
          return sc.correlated;
        },
        order: null,
      };
    }
    for (const item of core.from) this.addSource(sc, item);
    const isAgg = core.groupBy.length > 0 || core.having !== null || core.cols.some((c) => c.k === 'expr' && hasAgg(c.e)) || (order ?? []).some((t) => hasAgg(t.e));
    const aliases = new Map<string, Expr>();
    for (const c of core.cols) if (c.k === 'expr' && c.alias) aliases.set(lower(c.alias), c.e);
    sc.aliases = aliases;
    if (core.where) this.addProbes(sc, core.where, null);
    const where = core.where ? this.compile(core.where, sc) : null;
    // GROUP BY terms may name result columns by position
    const groupBy = core.groupBy.map((g, n) => {
      if (g.k === 'lit' && typeof g.v === 'number' && Number.isInteger(g.v)) {
        const exprCols = core.cols;
        if (g.v < 1 || g.v > exprCols.length) throw parseError(`${ordinal(n + 1)} GROUP BY term out of range - should be between 1 and ${exprCols.length}`);
        const rc = exprCols[g.v - 1];
        if (rc.k === 'expr') return this.compile(rc.e, sc);
      }
      return this.compile(g, sc);
    });
    if (isAgg) {
      sc.agg = [];
      sc.aggAllowed = true;
    }
    sc.win = [];
    sc.winAllowed = true;
    const { names, exprs, items } = this.resultList(core.cols, sc);
    sc.winAllowed = false;
    const having = core.having ? this.compile(core.having, sc) : null;
    sc.winAllowed = true;
    const orderC = order?.map((t, n) => {
      let e = t.e;
      let coll: Collation | null = null;
      let collX = false;
      if (e.k === 'collate') {
        coll = collationOf(e.coll);
        collX = true;
        e = e.e;
      }
      let idx = -1;
      if (e.k === 'lit' && typeof e.v === 'number' && Number.isInteger(e.v)) {
        idx = e.v - 1;
        if (idx < 0 || idx >= exprs.length) throw parseError(`${ordinal(n + 1)} ORDER BY term out of range - should be between 1 and ${exprs.length}`);
      } else if (e.k === 'col' && !e.tbl) {
        const name = lower(e.name);
        idx = items.findIndex((it) => it.alias !== null && lower(it.alias) === name);
      }
      if (idx >= 0) return { idx, c: null, desc: t.desc, nulls: t.nulls, coll: collX ? coll : exprs[idx].coll };
      const c = this.compile(t.e, sc);
      return { idx: -1, c, desc: t.desc, nulls: t.nulls, coll: c.coll };
    }) ?? null;
    sc.winAllowed = false;
    const aggSlots = sc.agg;
    const winSlots = sc.win;
    const distinct = core.distinct;
    const sources = sc.sources;
    const nsrc = sources.length;
    let minmax = -1;
    if (aggSlots) {
      const mm = aggSlots.map((s, i) => (s.name === 'min' || s.name === 'max' ? i : -1)).filter((i) => i >= 0);
      if (mm.length === 1) minmax = mm[0];
    }
    const evalRow = (env: Env): OutRow => {
      const vals = exprs.map((c) => c.ev(env));
      const keys = orderC ? orderC.map((o) => (o.idx >= 0 ? vals[o.idx] : o.c!.ev(env))) : null;
      return { vals, keys };
    };
    const run = (penv: Env | null): OutRow[] => {
      const env = mkEnv(nsrc, penv);
      let envs: Env[] = [];
      const direct: OutRow[] = [];
      const needEnvs = winSlots.length > 0;
      if (!aggSlots) {
        this.loopJoin(sources, env, 0, () => {
          if (where && !isTrue(where.ev(env))) return;
          if (needEnvs) envs.push({ rows: env.rows.slice(), rowids: env.rowids.slice(), parent: penv, agg: null, win: null });
          else direct.push(evalRow(env));
        });
      } else {
        const groups = new Map<string, { rows: (SqlValue[] | null)[]; rowids: (number | null)[]; accs: unknown[]; seen: (Set<string> | null)[] }>();
        this.loopJoin(sources, env, 0, () => {
          if (where && !isTrue(where.ev(env))) return;
          let gk = '';
          for (const g of groupBy) gk += valueKey(g.ev(env), g.coll) + '\u0000';
          let g = groups.get(gk);
          if (!g) {
            g = { rows: env.rows.slice(), rowids: env.rowids.slice(), accs: aggSlots.map((s) => s.fn.init()), seen: aggSlots.map((s) => (s.distinct ? new Set<string>() : null)) };
            groups.set(gk, g);
          }
          let representative = minmax < 0;
          for (let j = 0; j < aggSlots.length; j++) {
            const s = aggSlots[j];
            if (s.filter && !isTrue(s.filter.ev(env))) continue;
            const args = s.args.map((a) => a.ev(env));
            const seen = g.seen[j];
            if (seen) {
              if (args[0] === null) continue;
              const k = rowKey(args);
              if (seen.has(k)) continue;
              seen.add(k);
            }
            if (j === minmax) {
              const before = s.fn.final(g.accs[j]);
              g.accs[j] = s.fn.step(g.accs[j], args);
              if (compareValues(before, s.fn.final(g.accs[j])) !== 0) representative = true;
            } else {
              g.accs[j] = s.fn.step(g.accs[j], args);
            }
          }
          if (representative) {
            g.rows = env.rows.slice();
            g.rowids = env.rowids.slice();
          }
        });
        if (groups.size === 0 && groupBy.length === 0) {
          groups.set('', { rows: new Array(nsrc).fill(null), rowids: new Array(nsrc).fill(null), accs: aggSlots.map((s) => s.fn.init()), seen: [] });
        }
        for (const g of groups.values()) {
          const genv: Env = { rows: g.rows, rowids: g.rowids, parent: penv, agg: aggSlots.map((s, j) => s.fn.final(g.accs[j])), win: null };
          if (having && !isTrue(having.ev(genv))) continue;
          if (needEnvs) envs.push(genv);
          else direct.push(evalRow(genv));
        }
      }
      let out: OutRow[];
      if (needEnvs) {
        envs = this.computeWindows(envs, winSlots, !orderC);
        out = envs.map(evalRow);
      } else {
        out = direct;
      }
      return distinct ? dedupe(out) : out;
    };
    return {
      names,
      cols: exprs.map((c, i) => ({ name: names[i], aff: c.aff, coll: c.coll, real: c.real, hidden: false })),
      run,
      get correlated() {
        return sc.correlated;
      },
      order: orderC ? orderC.map((o) => ({ desc: o.desc, nulls: o.nulls, coll: o.coll })) : null,
    };
  }

  /** Evaluate window functions over the rows of one SELECT. Returns the rows in window order. */
  private computeWindows(envs: Env[], slots: WinSlot[], reorder: boolean): Env[] {
    for (const env of envs) env.win = new Array(slots.length).fill(null);
    let ordered = envs;
    slots.forEach((w, wi) => {
      const parts = new Map<string, Env[]>();
      for (const env of envs) {
        let k = '';
        for (const p of w.partition) k += valueKey(p.ev(env), p.coll) + '\u0000';
        let a = parts.get(k);
        if (!a) parts.set(k, (a = []));
        a.push(env);
      }
      const all: Env[] = [];
      for (const part of parts.values()) {
        const keys = new Map<Env, SqlValue[]>();
        for (const env of part) keys.set(env, w.order.map((o) => o.c.ev(env)));
        const cmp = (a: Env, b: Env) => compareKeys(keys.get(a)!, keys.get(b)!, w.order.map((o) => ({ desc: o.desc, nulls: o.nulls, coll: o.c.coll })));
        if (w.order.length) part.sort(cmp);
        const n = part.length;
        const gStart: number[] = new Array(n);
        const gEnd: number[] = new Array(n);
        const gNum: number[] = new Array(n);
        let num = 0;
        for (let i = 0; i < n; i++) {
          if (i > 0 && (w.order.length === 0 || cmp(part[i - 1], part[i]) === 0)) {
            gStart[i] = gStart[i - 1];
            gNum[i] = gNum[i - 1];
          } else {
            gStart[i] = i;
            gNum[i] = ++num;
          }
        }
        for (let i = n - 1; i >= 0; i--) gEnd[i] = i < n - 1 && gStart[i + 1] === gStart[i] ? gEnd[i + 1] : i;
        const arg = (k: number, env: Env) => (w.args[k] ? w.args[k].ev(env) : null);
        for (let i = 0; i < n; i++) {
          const env = part[i];
          let v: SqlValue = null;
          switch (w.name) {
            case 'row_number': v = i + 1; break;
            case 'rank': v = gStart[i] + 1; break;
            case 'dense_rank': v = gNum[i]; break;
            case 'percent_rank': v = n > 1 ? gStart[i] / (n - 1) : 0; break;
            case 'cume_dist': v = (gEnd[i] + 1) / n; break;
            case 'ntile': {
              const buckets = Math.max(1, Math.trunc(toNumber(arg(0, env))));
              const size = Math.floor(n / buckets);
              const big = n % buckets;
              const cut = big * (size + 1);
              v = i < cut ? Math.floor(i / (size + 1)) + 1 : big + Math.floor((i - cut) / Math.max(1, size)) + 1;
              break;
            }
            case 'lag':
            case 'lead': {
              const off = w.args.length > 1 ? Math.trunc(toNumber(arg(1, env))) : 1;
              const j = w.name === 'lag' ? i - off : i + off;
              v = j >= 0 && j < n ? arg(0, part[j]) : w.args.length > 2 ? arg(2, env) : null;
              break;
            }
            case 'first_value': v = arg(0, part[0]); break;
            case 'last_value': v = arg(0, part[w.order.length ? gEnd[i] : n - 1]); break;
            case 'nth_value': {
              const k = Math.trunc(toNumber(arg(1, env))) - 1;
              const end = w.order.length ? gEnd[i] : n - 1;
              v = k >= 0 && k <= end ? arg(0, part[k]) : null;
              break;
            }
          }
          if (!w.agg) env.win![wi] = v;
        }
        if (w.agg) {
          const fn = w.agg;
          let acc = fn.init();
          const seen = w.distinct ? new Set<string>() : null;
          const feed = (env: Env) => {
            if (w.filter && !isTrue(w.filter.ev(env))) return;
            const args = w.args.map((a) => a.ev(env));
            if (seen) {
              if (args[0] === null) return;
              const k = rowKey(args);
              if (seen.has(k)) return;
              seen.add(k);
            }
            acc = fn.step(acc, args);
          };
          if (!w.order.length) {
            part.forEach(feed);
            const v = fn.final(acc);
            for (const env of part) env.win![wi] = v;
          } else {
            for (let i = 0; i < n; ) {
              const end = gEnd[i];
              for (let j = i; j <= end; j++) feed(part[j]);
              const v = fn.final(acc);
              for (let j = i; j <= end; j++) part[j].win![wi] = v;
              i = end + 1;
            }
          }
        }
        all.push(...part);
      }
      if (wi === 0 && reorder) ordered = all;
    });
    return ordered;
  }

  // ---- expressions ----------------------------------------------------------------------

  private comparison(op: string, l: CExpr, r: CExpr): CExpr {
    const aff = comparisonAffinity(l.aff, r.aff);
    const coll = l.collX ? l.coll : r.collX ? r.coll : (l.coll ?? r.coll);
    const test =
      op === '=' ? (c: number) => c === 0
      : op === '!=' ? (c: number) => c !== 0
      : op === '<' ? (c: number) => c < 0
      : op === '<=' ? (c: number) => c <= 0
      : op === '>' ? (c: number) => c > 0
      : (c: number) => c >= 0;
    if (op === 'IS' || op === 'IS NOT') {
      const want = op === 'IS';
      return cexpr((env) => {
        const a = l.ev(env);
        const b = r.ev(env);
        if (a === null || b === null) return (a === null && b === null) === want ? 1 : 0;
        return (compareValues(convertFor(a, aff), convertFor(b, aff), coll) === 0) === want ? 1 : 0;
      });
    }
    return cexpr((env) => {
      const a = l.ev(env);
      if (a === null) return null;
      const b = r.ev(env);
      if (b === null) return null;
      return test(compareValues(convertFor(a, aff), convertFor(b, aff), coll)) ? 1 : 0;
    });
  }

  private resolveColumn(e: Extract<Expr, { k: 'col' }>, sc: Scope): CExpr {
    const lname = lower(e.name);
    const ltbl = e.tbl === null ? null : lower(e.tbl);
    let s: Scope | null = sc;
    let depth = 0;
    while (s) {
      let found: [number, number] | null = null;
      for (let si = 0; si < s.sources.length; si++) {
        const src = s.sources[si];
        if (ltbl !== null && src.name !== ltbl) continue;
        let ci = src.cols.findIndex((c) => lower(c.name) === lname && (ltbl !== null || !c.hidden));
        if (ci < 0 && src.rowid && (lname === 'rowid' || lname === 'oid' || lname === '_rowid_')) ci = -2;
        if (ci === -1) continue;
        if (found) throw parseError(`ambiguous column name: ${e.tbl ? e.tbl + '.' : ''}${e.name}`, e.pos);
        found = [si, ci];
      }
      if (found) {
        for (let m: Scope | null = sc, k = 0; m && k < depth; m = m.parent, k++) m.correlated = true;
        const [si, ci] = found;
        if (s.track) s.track.add(si);
        const d = depth;
        const up = (env: Env): Env => {
          let x = env;
          for (let k = 0; k < d; k++) x = x.parent!;
          return x;
        };
        if (ci === -2) {
          return cexpr(d === 0 ? (env) => env.rowids[si] ?? null : (env) => up(env).rowids[si] ?? null, { aff: 'INTEGER', colName: e.name });
        }
        const c = s.sources[si].cols[ci];
        const ev = d === 0
          ? (env: Env) => {
              const r = env.rows[si];
              return r ? r[ci] : null;
            }
          : (env: Env) => {
              const r = up(env).rows[si];
              return r ? r[ci] : null;
            };
        return cexpr(ev, { aff: c.aff, coll: c.coll, real: c.real, colName: c.name, src: d === 0 ? [si, ci] : undefined });
      }
      if (depth === 0 && ltbl === null && s.aliases && s.aliases.has(lname) && !s.aliasGuard.has(lname)) {
        s.aliasGuard.add(lname);
        try {
          return this.compile(s.aliases.get(lname)!, s);
        } finally {
          s.aliasGuard.delete(lname);
        }
      }
      s = s.parent;
      depth++;
    }
    throw parseError(`no such column: ${e.tbl ? e.tbl + '.' : ''}${e.name}`, e.pos);
  }

  private subPlan(sub: Select, sc: Scope): Plan {
    return this.compileSelect(sub, sc, sc.ctes);
  }

  private compile(e: Expr, sc: Scope): CExpr {
    switch (e.k) {
      case 'lit': {
        const v = e.v;
        return cexpr(() => v, { real: !!e.real });
      }
      case 'col':
        return this.resolveColumn(e, sc);
      case 'ctime': {
        return cexpr(() => {
          const t = SCALARS.datetime.fn(['now'], this.fnCtx) as string;
          return e.which === 'CURRENT_TIMESTAMP' ? t : e.which === 'CURRENT_DATE' ? t.slice(0, 10) : t.slice(11);
        });
      }
      case 'collate': {
        const inner = this.compile(e.e, sc);
        const coll = collationOf(e.coll);
        if (!coll) throw parseError(`no such collation sequence: ${e.coll}`);
        return { ...inner, coll, collX: true };
      }
      case 'unary': {
        const x = this.compile(e.e, sc);
        switch (e.op) {
          case '-':
            return cexpr((env) => {
              const v = x.ev(env);
              return v === null ? null : -toNumber(v);
            }, { real: x.real });
          case '+':
            return { ...x, aff: null, colName: undefined, src: undefined };
          case '~':
            return cexpr((env) => {
              const v = x.ev(env);
              return v === null ? null : Number(BigInt.asIntN(64, ~toBig(toNumber(v))));
            });
          case 'NOT':
            return cexpr((env) => {
              const v = truth(x.ev(env));
              return v === null ? null : v ? 0 : 1;
            });
        }
        break;
      }
      case 'bin': {
        const l = this.compile(e.l, sc);
        const r = this.compile(e.r, sc);
        switch (e.op) {
          case 'AND':
            return cexpr((env) => {
              const a = truth(l.ev(env));
              if (a === false) return 0;
              const b = truth(r.ev(env));
              if (b === false) return 0;
              return a === null || b === null ? null : 1;
            });
          case 'OR':
            return cexpr((env) => {
              const a = truth(l.ev(env));
              if (a === true) return 1;
              const b = truth(r.ev(env));
              if (b === true) return 1;
              return a === null || b === null ? null : 0;
            });
          case '=':
          case '!=':
          case '<':
          case '<=':
          case '>':
          case '>=':
          case 'IS':
          case 'IS NOT':
            return this.comparison(e.op, l, r);
          case '||':
            return cexpr((env) => {
              const a = l.ev(env);
              if (a === null) return null;
              const b = r.ev(env);
              if (b === null) return null;
              return sized(toText(a)! + toText(b)!);
            });
          case '+':
          case '-':
          case '*':
          case '/':
          case '%': {
            const real = l.real || r.real;
            const op = e.op;
            return cexpr((env) => {
              const a = l.ev(env);
              if (a === null) return null;
              const b = r.ev(env);
              if (b === null) return null;
              const [x, xi] = numInfo(a);
              const [y, yi] = numInfo(b);
              const ints = !real && xi && yi;
              switch (op) {
                case '+': return x + y;
                case '-': return x - y;
                case '*': return x * y;
                case '/':
                  if (y === 0) return null;
                  return ints ? Math.trunc(x / y) : x / y;
                default: {
                  if (ints) {
                    if (y === 0) return null;
                    return x % y;
                  }
                  const yt = Math.trunc(y);
                  if (yt === 0) return null;
                  return Math.trunc(x) % yt;
                }
              }
            }, { real });
          }
          case '&':
          case '|':
          case '<<':
          case '>>': {
            const op = e.op;
            return cexpr((env) => {
              const a = l.ev(env);
              const b = r.ev(env);
              if (a === null || b === null) return null;
              const x = toBig(toNumber(a));
              const y = toBig(toNumber(b));
              let z: bigint;
              if (op === '&') z = x & y;
              else if (op === '|') z = x | y;
              else if (op === '<<') z = y >= 64n ? 0n : y < 0n ? x >> -y : x << y;
              else z = y >= 64n ? (x < 0n ? -1n : 0n) : y < 0n ? x << -y : x >> y;
              return Number(BigInt.asIntN(64, z));
            });
          }
        }
        throw parseError(`near "${e.op}": syntax error`);
      }
      case 'like': {
        if (e.op === 'REGEXP') throw parseError('no such function: REGEXP', e.pos);
        if (e.op === 'MATCH') throw parseError('unable to use function MATCH in the requested context', e.pos);
        const l = this.compile(e.l, sc);
        const r = this.compile(e.r, sc);
        const esc = e.esc ? this.compile(e.esc, sc) : null;
        const not = e.not;
        const isLike = e.op === 'LIKE';
        return cexpr((env) => {
          const a = l.ev(env);
          const p = r.ev(env);
          if (a === null || p === null) return null;
          let ec: string | null = null;
          if (esc) {
            const ev = esc.ev(env);
            if (ev === null) return null;
            ec = toText(ev)!;
            if (Array.from(ec).length !== 1) throw runtimeError('ESCAPE expression must be a single character');
          }
          const m = isLike ? like(toText(p)!, toText(a)!, ec) : glob(toText(p)!, toText(a)!);
          return m !== not ? 1 : 0;
        });
      }
      case 'isnull': {
        const x = this.compile(e.e, sc);
        const not = e.not;
        return cexpr((env) => ((x.ev(env) === null) !== not ? 1 : 0));
      }
      case 'between': {
        const x = this.compile(e.e, sc);
        const ge = this.comparison('>=', x, this.compile(e.lo, sc));
        const le = this.comparison('<=', x, this.compile(e.hi, sc));
        const not = e.not;
        return cexpr((env) => {
          const a = truth(ge.ev(env));
          const b = a === false ? false : truth(le.ev(env));
          const v = a === false || b === false ? false : a === null || b === null ? null : true;
          return v === null ? null : v !== not ? 1 : 0;
        });
      }
      case 'in': {
        const x = this.compile(e.e, sc);
        const not = e.not;
        if (e.list) {
          const items = e.list.map((i) => this.compile(i, sc));
          const affs = items.map((i) => comparisonAffinity(x.aff, i.aff));
          const coll = x.collX ? x.coll : x.coll;
          return cexpr((env) => {
            const v = x.ev(env);
            if (items.length === 0) return not ? 1 : 0;
            if (v === null) return null;
            let sawNull = false;
            for (let k = 0; k < items.length; k++) {
              const w = items[k].ev(env);
              if (w === null) {
                sawNull = true;
                continue;
              }
              if (compareValues(convertFor(v, affs[k]), convertFor(w, affs[k]), coll) === 0) return not ? 0 : 1;
            }
            return sawNull ? null : not ? 1 : 0;
          });
        }
        const plan = this.subPlan(e.sub!, sc);
        if (plan.cols.length !== 1) throw parseError(`sub-select returns ${plan.cols.length} columns - expected 1`);
        const aff = comparisonAffinity(x.aff, plan.cols[0].aff);
        const coll = x.coll ?? plan.cols[0].coll;
        let cache: { keys: Set<string>; hasNull: boolean; empty: boolean } | null = null;
        const build = (env: Env) => {
          const rows = plan.run(env);
          const keys = new Set<string>();
          let hasNull = false;
          for (const r of rows) {
            if (r[0] === null) hasNull = true;
            else keys.add(valueKey(convertFor(r[0], aff), coll));
          }
          return { keys, hasNull, empty: rows.length === 0 };
        };
        return cexpr((env) => {
          const set = plan.correlated ? build(env) : (cache ??= build(env));
          if (set.empty) return not ? 1 : 0;
          const v = x.ev(env);
          if (v === null) return null;
          if (set.keys.has(valueKey(convertFor(v, aff), coll))) return not ? 0 : 1;
          return set.hasNull ? null : not ? 1 : 0;
        });
      }
      case 'exists': {
        const plan = this.subPlan(e.sub, sc);
        let cache: SqlValue | undefined;
        return cexpr((env) => {
          if (!plan.correlated && cache !== undefined) return cache;
          const v = plan.run(env).length > 0 ? 1 : 0;
          if (!plan.correlated) cache = v;
          return v;
        });
      }
      case 'subq': {
        const plan = this.subPlan(e.sub, sc);
        if (plan.cols.length !== 1) throw parseError(`sub-select returns ${plan.cols.length} columns - expected 1`);
        let cache: SqlValue | undefined;
        return cexpr((env) => {
          if (!plan.correlated && cache !== undefined) return cache;
          const rows = plan.run(env);
          const v = rows.length ? rows[0][0] : null;
          if (!plan.correlated) cache = v;
          return v;
        }, { aff: plan.cols[0].aff, coll: plan.cols[0].coll, real: plan.cols[0].real });
      }
      case 'case': {
        const base = e.base ? this.compile(e.base, sc) : null;
        const whens = e.whens.map(([w, t]) => {
          const wc = this.compile(w, sc);
          return [base ? this.comparison('=', base, wc) : wc, this.compile(t, sc)] as [CExpr, CExpr];
        });
        const els = e.els ? this.compile(e.els, sc) : null;
        const real = whens.some(([, t]) => t.real) || !!els?.real;
        return cexpr((env) => {
          for (const [w, t] of whens) if (isTrue(w.ev(env))) return t.ev(env);
          return els ? els.ev(env) : null;
        }, { real });
      }
      case 'cast': {
        const x = this.compile(e.e, sc);
        const aff = affinityOf(e.type);
        return cexpr((env) => castTo(x.ev(env), aff), { aff: aff === 'BLOB' ? null : aff, real: aff === 'REAL' });
      }
      case 'fn':
        return this.compileCall(e, sc);
    }
    throw parseError('unsupported expression');
  }

  private compileCall(e: Extract<Expr, { k: 'fn' }>, sc: Scope): CExpr {
    const name = e.name;
    const nargs = e.args.length;
    if (e.over) {
      if (!sc.win || !sc.winAllowed) throw parseError(`misuse of window function ${name}()`, e.pos);
      const agg = name in AGGREGATES && (name !== 'min' && name !== 'max' ? true : nargs === 1) ? AGGREGATES[name] : null;
      if (!agg && !WINDOW_ONLY.has(name)) {
        if (name in SCALARS) throw parseError(`${name}() may not be used as a window function`, e.pos);
        throw parseError(`no such function: ${name}`, e.pos);
      }
      const counts: Record<string, [number, number]> = {
        row_number: [0, 0], rank: [0, 0], dense_rank: [0, 0], percent_rank: [0, 0], cume_dist: [0, 0], ntile: [1, 1],
        lag: [1, 3], lead: [1, 3], first_value: [1, 1], last_value: [1, 1], nth_value: [2, 2],
      };
      const [lo, hi] = agg ? [agg.min, agg.max] : counts[name];
      if ((e.star && name !== 'count') || nargs < lo || nargs > hi) throw parseError(`wrong number of arguments to function ${name}()`, e.pos);
      const prevWin = sc.winAllowed;
      sc.winAllowed = false;
      const args = e.args.map((a) => this.compile(a, sc));
      const partition = e.over.partition.map((p) => this.compile(p, sc));
      const order = e.over.order.map((t) => ({ c: this.compile(t.e, sc), desc: t.desc, nulls: t.nulls }));
      const filter = e.filter ? this.compile(e.filter, sc) : null;
      sc.winAllowed = prevWin;
      const slot = sc.win.push({ name, agg, args, distinct: e.distinct, filter, partition, order }) - 1;
      const real = !!agg?.real || ['percent_rank', 'cume_dist'].includes(name);
      return cexpr((env) => (env.win ? env.win[slot] : null), { real });
    }
    if (isAggregate(name, e.star ? 0 : nargs) && !(e.star && name !== 'count')) {
      if (!sc.agg || !sc.aggAllowed) {
        throw parseError(sc.inAggArgs ? `misuse of aggregate function ${name}()` : `misuse of aggregate: ${name}()`, e.pos);
      }
      const fn = AGGREGATES[name];
      if (nargs < fn.min || nargs > fn.max || (e.star && nargs > 0)) throw parseError(`wrong number of arguments to function ${name}()`, e.pos);
      if (name === 'count' && !e.star && nargs === 0) throw parseError(`wrong number of arguments to function ${name}()`, e.pos);
      sc.aggAllowed = false;
      sc.inAggArgs = true;
      const prevWin = sc.winAllowed;
      sc.winAllowed = false;
      let args: CExpr[];
      let filter: CExpr | null;
      try {
        args = e.args.map((a) => this.compile(a, sc));
        filter = e.filter ? this.compile(e.filter, sc) : null;
      } finally {
        sc.aggAllowed = true;
        sc.inAggArgs = false;
        sc.winAllowed = prevWin;
      }
      const slot = sc.agg.push({ name, fn, args, distinct: e.distinct, filter }) - 1;
      const real = !!fn.real || ((name === 'sum' || name === 'min' || name === 'max') && args[0]?.real);
      const aff = name === 'min' || name === 'max' ? args[0].aff : null;
      return cexpr((env) => (env.agg ? env.agg[slot] : null), { real, aff, coll: name === 'min' || name === 'max' ? args[0].coll : null });
    }
    if (WINDOW_ONLY.has(name)) throw parseError(`misuse of window function ${name}()`, e.pos);
    const f = SCALARS[name];
    if (!f) throw parseError(`no such function: ${name}`, e.pos);
    if (e.star || nargs < f.min || (f.max >= 0 && nargs > f.max)) throw parseError(`wrong number of arguments to function ${name}()`, e.pos);
    if (e.distinct) throw parseError(`DISTINCT aggregates must have exactly one argument`, e.pos);
    const args = e.args.map((a) => this.compile(a, sc));
    const ctx = this.fnCtx;
    const real = !!f.real || (['abs', 'min', 'max', 'coalesce', 'ifnull', 'nullif', 'iif', 'sign'].includes(name) && args.some((a) => a.real));
    if (name === 'typeof') {
      const a = args[0];
      return cexpr((env) => {
        const v = a.ev(env);
        if (typeof v === 'number' && a.real) return 'real';
        return f.fn([v], ctx);
      });
    }
    if (name === 'coalesce' || name === 'ifnull') {
      return cexpr((env) => {
        for (const a of args) {
          const v = a.ev(env);
          if (v !== null) return v;
        }
        return null;
      }, { real });
    }
    if (name === 'iif') {
      return cexpr((env) => (isTrue(args[0].ev(env)) ? args[1].ev(env) : args[2].ev(env)), { real });
    }
    const n = args.length;
    return cexpr((env) => {
      const vals: SqlValue[] = new Array(n);
      for (let k = 0; k < n; k++) vals[k] = args[k].ev(env);
      return sized(f.fn(vals, ctx));
    }, { real, coll: name === 'min' || name === 'max' ? args[0]?.coll ?? null : null });
  }
}

/** Edits the table and column names in a stored CREATE INDEX statement. */
class IndexSqlEditor {
  private sql: string;
  constructor(sql: string) {
    this.sql = sql;
  }

  private tokens() {
    const out = [];
    for (let pos = 0; ; ) {
      const t = lex(this.sql, pos);
      if (t.type === 'eof') return out;
      out.push(t);
      pos = t.end;
    }
  }

  replaceTable(quoted: string): string {
    const toks = this.tokens();
    const on = toks.findIndex((t) => t.type === 'id' && t.upper === 'ON');
    const t = toks[on + 1];
    if (!t) return this.sql;
    return this.sql.slice(0, t.start) + quoted + this.sql.slice(t.end);
  }

  replaceColumn(from: string, to: string): string {
    const toks = this.tokens();
    const open = toks.findIndex((t) => t.type === 'op' && t.value === '(');
    let sql = this.sql;
    for (let i = toks.length - 1; i > open && open >= 0; i--) {
      const t = toks[i];
      if (t.type === 'id' && lower(t.value) === lower(from) && !(toks[i + 1]?.type === 'op' && toks[i + 1].value === '(')) {
        const rep = t.quoted ? '"' + to.replace(/"/g, '""') + '"' : to;
        sql = sql.slice(0, t.start) + rep + sql.slice(t.end);
      }
    }
    return sql;
  }
}

/** Whether any of these SELECT cores reads the table `name` in its FROM clause. */
function refersTo(cores: Core[], name: string): boolean {
  return cores.some((c) => c.k === 'core' && c.from.some((f) => f.src.k === 'table' && lower(f.src.t.name) === name));
}

function hasNonConst(e: Expr): boolean {
  switch (e.k) {
    case 'lit':
      return false;
    case 'unary':
    case 'collate':
    case 'cast':
      return hasNonConst(e.e);
    case 'bin':
      return hasNonConst(e.l) || hasNonConst(e.r);
    default:
      return true;
  }
}

function castTo(v: SqlValue, aff: Aff): SqlValue {
  if (v === null) return null;
  switch (aff) {
    case 'INTEGER': {
      if (typeof v === 'number') return Math.trunc(v);
      const m = /^\s*[+-]?\d+/.exec(v);
      return m ? Number(m[0]) : 0;
    }
    case 'REAL':
      return toNumber(v);
    case 'NUMERIC':
      return typeof v === 'number' ? v : toNumber(v);
    case 'TEXT':
    case 'BLOB':
      return typeof v === 'number' ? numToText(v) : v;
    default:
      return v;
  }
}

function compareRows(a: SqlValue[], b: SqlValue[]): number {
  for (let i = 0; i < a.length; i++) {
    const c = compareValues(a[i], b[i]);
    if (c) return c;
  }
  return 0;
}

function compareKeys(a: SqlValue[], b: SqlValue[], terms: { desc: boolean; nulls: OrderTerm['nulls']; coll: Collation | null }[]): number {
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const x = a[i];
    const y = b[i];
    if (t.nulls && (x === null) !== (y === null)) return (x === null) === (t.nulls === 'first') ? -1 : 1;
    let c = compareValues(x, y, t.coll);
    if (t.desc) c = -c;
    if (c) return c;
  }
  return 0;
}

function sortRows(rows: OutRow[], terms: { desc: boolean; nulls: OrderTerm['nulls']; coll: Collation | null }[]): void {
  rows.sort((a, b) => compareKeys(a.keys!, b.keys!, terms));
}

function dedupe(rows: OutRow[]): OutRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = rowKey(r.vals);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
