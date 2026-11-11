// Syntax tree for the SQL dialect the engine understands.

import type { SqlValue } from './errors.ts';

export type Expr =
  | { k: 'lit'; v: SqlValue; real?: boolean }
  | { k: 'col'; tbl: string | null; name: string; pos: number }
  | { k: 'unary'; op: '-' | '+' | '~' | 'NOT'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'like'; op: 'LIKE' | 'GLOB' | 'REGEXP' | 'MATCH'; not: boolean; l: Expr; r: Expr; esc: Expr | null; pos: number }
  | { k: 'isnull'; not: boolean; e: Expr }
  | { k: 'between'; not: boolean; e: Expr; lo: Expr; hi: Expr }
  | { k: 'in'; not: boolean; e: Expr; list: Expr[] | null; sub: Select | null }
  | { k: 'exists'; sub: Select }
  | { k: 'subq'; sub: Select }
  | { k: 'case'; base: Expr | null; whens: [Expr, Expr][]; els: Expr | null }
  | { k: 'cast'; e: Expr; type: string }
  | { k: 'fn'; name: string; args: Expr[]; star: boolean; distinct: boolean; pos: number; filter: Expr | null; over: WindowSpec | null }
  | { k: 'collate'; e: Expr; coll: string }
  | { k: 'ctime'; which: 'CURRENT_TIMESTAMP' | 'CURRENT_DATE' | 'CURRENT_TIME' };

export interface WindowSpec {
  partition: Expr[];
  order: OrderTerm[];
}

export interface OrderTerm {
  e: Expr;
  desc: boolean;
  nulls: 'first' | 'last' | null;
}

export interface Cte {
  name: string;
  cols: string[] | null;
  sel: Select;
  recursive: boolean;
}

export interface Select {
  k: 'select';
  with: Cte[] | null;
  cores: Core[];
  ops: string[]; // between cores: 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT'
  orderBy: OrderTerm[];
  limit: Expr | null;
  offset: Expr | null;
}

export type Core =
  | {
      k: 'core';
      distinct: boolean;
      cols: ResultCol[];
      from: FromItem[];
      where: Expr | null;
      groupBy: Expr[];
      having: Expr | null;
    }
  | { k: 'values'; rows: Expr[][] };

export type ResultCol =
  | { k: 'star'; tbl: string | null; pos: number }
  | { k: 'expr'; e: Expr; alias: string | null; span: string };

export interface TableName {
  schema: string | null;
  name: string;
  pos: number;
}

export type FromSource =
  | { k: 'table'; t: TableName }
  | { k: 'sub'; sel: Select }
  | { k: 'tvf'; name: string; args: Expr[]; pos: number };

export interface FromItem {
  src: FromSource;
  alias: string | null;
  join: 'first' | 'inner' | 'left' | 'cross';
  natural: boolean;
  on: Expr | null;
  using: string[] | null;
}

export type Conflict = 'ROLLBACK' | 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE';

export interface SetClause {
  cols: { name: string; pos: number }[];
  e: Expr; // for several columns: a 'subq'-free list is split by the parser, so this is one value
}

export interface Upsert {
  target: string[] | null;
  sets: SetClause[] | null; // null: DO NOTHING
  where: Expr | null;
}

export interface ColumnDef {
  name: string;
  nameStart: number;
  nameEnd: number;
  start: number;
  end: number;
  type: string;
  pk: { desc: boolean; autoinc: boolean } | null;
  notNull: boolean;
  unique: boolean;
  dflt: Expr | null;
  dfltText: string | null;
  coll: string | null;
}

export interface NameRef {
  name: string;
  start: number;
  end: number;
}

export type TableConstraint = { k: 'pk' | 'unique'; cols: NameRef[] } | { k: 'other'; cols: NameRef[] };

export interface TableDef {
  cols: ColumnDef[];
  constraints: TableConstraint[];
  close: number; // offset of the closing ')' of the column list
}

export type AlterAction =
  | { k: 'rename'; to: string }
  | { k: 'renameCol'; from: string; to: string; toQuoted: boolean }
  | { k: 'add'; text: string }
  | { k: 'dropCol'; name: string };

export type Stmt =
  | Select
  | {
      k: 'insert';
      with: Cte[] | null;
      or: Conflict | null;
      table: TableName;
      alias: string | null;
      cols: { name: string; pos: number }[] | null;
      values: Expr[][] | null;
      sel: Select | null;
      upsert: Upsert[];
      returning: ResultCol[] | null;
    }
  | {
      k: 'update';
      with: Cte[] | null;
      or: Conflict | null;
      table: TableName;
      alias: string | null;
      sets: SetClause[];
      from: FromItem[];
      where: Expr | null;
      returning: ResultCol[] | null;
    }
  | { k: 'delete'; with: Cte[] | null; table: TableName; alias: string | null; where: Expr | null; returning: ResultCol[] | null }
  | { k: 'createTable'; ifNot: boolean; table: TableName; asSel: Select | null; sql: string }
  | { k: 'createIndex'; ifNot: boolean; unique: boolean; name: TableName; table: TableName; cols: { e: Expr; pos: number }[]; where: Expr | null; sql: string }
  | { k: 'createView'; ifNot: boolean; name: TableName; cols: string[] | null; sel: Select; sql: string }
  | { k: 'drop'; what: 'TABLE' | 'INDEX' | 'VIEW'; ifExists: boolean; name: TableName }
  | { k: 'alter'; table: TableName; action: AlterAction }
  | { k: 'begin' }
  | { k: 'commit' }
  | { k: 'rollback'; to: string | null }
  | { k: 'savepoint'; name: string }
  | { k: 'release'; name: string }
  | { k: 'pragma'; schema: string | null; name: string; arg: string | null }
  | { k: 'noop' };
