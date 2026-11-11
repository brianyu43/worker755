// Recursive-descent parser for SQLite's SQL. Statements are parsed one at a time, so the ones
// before a syntax error can run first, as sqlite3_prepare() + step does.

import { parseError } from './errors.ts';
import type { SqlError } from './errors.ts';
import { lex, RESERVED } from './tokenizer.ts';
import type { Token } from './tokenizer.ts';
import type {
  AlterAction, ColumnDef, Conflict, Core, Cte, Expr, FromItem, NameRef, OrderTerm, ResultCol, Select,
  SetClause, Stmt, TableConstraint, TableDef, TableName, Upsert, WindowSpec,
} from './ast.ts';

export interface ParsedStmt {
  stmt: Stmt;
  start: number; // where sqlite would consider the statement to start
  end: number; // end of its last token
}

const COMPARE_OPS = new Set(['<', '<=', '>', '>=']);
const EQUALITY_OPS = new Set(['=', '==', '!=', '<>']);
const TYPE_STOP = new Set(['CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS']);

export class Parser {
  private sql: string;
  private toks: Token[] = [];
  private i = 0;
  private lexPos = 0;
  private nextStart = 0;

  constructor(sql: string) {
    this.sql = sql;
  }

  // ---- token access ---------------------------------------------------------------------

  private peek(k = 0): Token {
    while (this.toks.length <= this.i + k) {
      const last = this.toks[this.toks.length - 1];
      if (last && last.type === 'eof') return last;
      const t = lex(this.sql, this.lexPos);
      this.toks.push(t);
      this.lexPos = t.end;
    }
    return this.toks[this.i + k];
  }

  private advance(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.i++;
    return t;
  }

  private prevEnd(): number {
    return this.i > 0 ? this.toks[this.i - 1].end : 0;
  }

  private isKw(word: string, k = 0): boolean {
    const t = this.peek(k);
    return t.type === 'id' && !t.quoted && t.upper === word;
  }

  private eatKw(word: string): boolean {
    if (!this.isKw(word)) return false;
    this.i++;
    return true;
  }

  private kw(word: string): void {
    if (!this.eatKw(word)) this.fail();
  }

  private isOp(op: string, k = 0): boolean {
    const t = this.peek(k);
    return t.type === 'op' && t.value === op;
  }

  private eatOp(op: string): boolean {
    if (!this.isOp(op)) return false;
    this.i++;
    return true;
  }

  private op(op: string): void {
    if (!this.eatOp(op)) this.fail();
  }

  /** A syntax error at the current token. */
  private fail(t: Token = this.peek()): never {
    if (t.type === 'eof') throw parseError('incomplete input');
    throw parseError(`near "${this.sql.slice(t.start, t.end)}": syntax error`, t.start);
  }

  /** True when the token can be used as a bare name. */
  private isName(k = 0, allowString = false): boolean {
    const t = this.peek(k);
    if (t.type === 'id') return t.quoted || !RESERVED.has(t.upper);
    return allowString && t.type === 'str';
  }

  private name(allowString = false): Token {
    if (!this.isName(0, allowString)) this.fail();
    return this.advance();
  }

  // ---- statements -----------------------------------------------------------------------

  /** The next statement, or null at the end of the input. */
  next(): ParsedStmt | null {
    // tokens of finished statements are no longer needed
    this.toks = this.toks.slice(this.i);
    this.i = 0;
    for (;;) {
      let start = this.nextStart;
      let t: Token;
      try {
        t = this.peek();
      } catch (e) {
        (e as SqlError).stmtStart = start;
        throw e;
      }
      if (t.type === 'eof') return null;
      if (t.type === 'op' && t.value === ';') {
        this.i++;
        this.nextStart = this.skipWs(t.end);
        continue;
      }
      try {
        const stmt = this.statement();
        const end = this.prevEnd();
        const after = this.peek();
        if (after.type === 'op' && after.value === ';') {
          this.i++;
          this.nextStart = this.skipWs(after.end);
        } else if (after.type !== 'eof') {
          this.fail(after);
        } else {
          this.nextStart = after.end;
        }
        return { stmt, start, end };
      } catch (e) {
        if (e && typeof e === 'object' && 'kind' in e) (e as SqlError).stmtStart = start;
        throw e;
      }
    }
  }

  private skipWs(pos: number): number {
    while (pos < this.sql.length && /\s/.test(this.sql[pos])) pos++;
    return pos;
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.type !== 'id' || t.quoted) this.fail();
    switch (t.upper) {
      case 'SELECT':
      case 'VALUES':
        return this.select();
      case 'WITH': {
        const withs = this.withClause();
        if (this.isKw('SELECT') || this.isKw('VALUES')) {
          const sel = this.select();
          sel.with = withs;
          return sel;
        }
        if (this.isKw('INSERT') || this.isKw('REPLACE')) return this.insert(withs);
        if (this.isKw('UPDATE')) return this.update(withs);
        if (this.isKw('DELETE')) return this.delete(withs);
        return this.fail();
      }
      case 'INSERT':
      case 'REPLACE':
        return this.insert(null);
      case 'UPDATE':
        return this.update(null);
      case 'DELETE':
        return this.delete(null);
      case 'CREATE':
        return this.create();
      case 'DROP':
        return this.drop();
      case 'ALTER':
        return this.alter();
      case 'BEGIN':
        this.i++;
        if (this.isKw('DEFERRED') || this.isKw('IMMEDIATE') || this.isKw('EXCLUSIVE')) this.i++;
        if (this.eatKw('TRANSACTION') && this.isName()) this.i++;
        return { k: 'begin' };
      case 'COMMIT':
      case 'END':
        this.i++;
        if (this.eatKw('TRANSACTION') && this.isName()) this.i++;
        return { k: 'commit' };
      case 'ROLLBACK': {
        this.i++;
        if (this.eatKw('TRANSACTION') && this.isName() && !this.isKw('TO')) this.i++;
        if (this.eatKw('TO')) {
          this.eatKw('SAVEPOINT');
          return { k: 'rollback', to: this.name().value };
        }
        return { k: 'rollback', to: null };
      }
      case 'SAVEPOINT':
        this.i++;
        return { k: 'savepoint', name: this.name().value };
      case 'RELEASE':
        this.i++;
        this.eatKw('SAVEPOINT');
        return { k: 'release', name: this.name().value };
      case 'PRAGMA':
        return this.pragma();
      case 'VACUUM':
      case 'ANALYZE':
      case 'REINDEX':
        this.i++;
        while (this.isName() || this.isOp('.')) this.i++;
        return { k: 'noop' };
      default:
        return this.fail();
    }
  }

  private tableName(): TableName {
    const first = this.name(true);
    if (this.isOp('.')) {
      this.i++;
      const second = this.name(true);
      return { schema: first.value, name: second.value, pos: second.start };
    }
    return { schema: null, name: first.value, pos: first.start };
  }

  private pragma(): Stmt {
    this.kw('PRAGMA');
    let schema: string | null = null;
    let name = this.name().value;
    if (this.eatOp('.')) {
      schema = name;
      name = this.name().value;
    }
    let arg: string | null = null;
    const value = (): string => {
      let sign = '';
      if (this.isOp('-') || this.isOp('+')) sign = this.advance().value === '-' ? '-' : '';
      const t = this.advance();
      if (t.type === 'num' || t.type === 'str' || t.type === 'id') return sign + t.value;
      return this.fail(t);
    };
    if (this.eatOp('=')) {
      arg = value();
    } else if (this.eatOp('(')) {
      arg = value();
      this.op(')');
    }
    return { k: 'pragma', schema, name, arg };
  }

  // ---- SELECT ---------------------------------------------------------------------------

  private withClause(): Cte[] {
    this.kw('WITH');
    const recursive = this.eatKw('RECURSIVE');
    const ctes: Cte[] = [];
    do {
      const name = this.name().value;
      let cols: string[] | null = null;
      if (this.eatOp('(')) {
        cols = [];
        do cols.push(this.name().value);
        while (this.eatOp(','));
        this.op(')');
      }
      this.kw('AS');
      if (this.eatKw('NOT')) this.kw('MATERIALIZED');
      else this.eatKw('MATERIALIZED');
      this.op('(');
      const sel = this.select();
      this.op(')');
      ctes.push({ name, cols, sel, recursive });
    } while (this.eatOp(','));
    return ctes;
  }

  select(): Select {
    let withs: Cte[] | null = null;
    if (this.isKw('WITH')) withs = this.withClause();
    const cores: Core[] = [this.core()];
    const ops: string[] = [];
    for (;;) {
      if (this.eatKw('UNION')) ops.push(this.eatKw('ALL') ? 'UNION ALL' : 'UNION');
      else if (this.eatKw('INTERSECT')) ops.push('INTERSECT');
      else if (this.eatKw('EXCEPT')) ops.push('EXCEPT');
      else break;
      cores.push(this.core());
    }
    let orderBy: OrderTerm[] = [];
    if (this.isKw('ORDER')) {
      this.i++;
      this.kw('BY');
      orderBy = this.orderTerms();
    }
    let limit: Expr | null = null;
    let offset: Expr | null = null;
    if (this.eatKw('LIMIT')) {
      limit = this.expr();
      if (this.eatKw('OFFSET')) offset = this.expr();
      else if (this.eatOp(',')) {
        offset = limit;
        limit = this.expr();
      }
    }
    return { k: 'select', with: withs, cores, ops, orderBy, limit, offset };
  }

  private orderTerms(): OrderTerm[] {
    const terms: OrderTerm[] = [];
    do {
      const e = this.expr();
      let desc = false;
      if (this.eatKw('DESC')) desc = true;
      else this.eatKw('ASC');
      let nulls: OrderTerm['nulls'] = null;
      if (this.eatKw('NULLS')) {
        if (this.eatKw('FIRST')) nulls = 'first';
        else {
          this.kw('LAST');
          nulls = 'last';
        }
      }
      terms.push({ e, desc, nulls });
    } while (this.eatOp(','));
    return terms;
  }

  private core(): Core {
    if (this.eatKw('VALUES')) return { k: 'values', rows: this.valueRows() };
    this.kw('SELECT');
    let distinct = false;
    if (this.eatKw('DISTINCT')) distinct = true;
    else this.eatKw('ALL');
    const cols = this.resultCols();
    let from: FromItem[] = [];
    if (this.eatKw('FROM')) from = this.from();
    const where = this.eatKw('WHERE') ? this.expr() : null;
    let groupBy: Expr[] = [];
    if (this.isKw('GROUP')) {
      this.i++;
      this.kw('BY');
      groupBy = this.exprList();
    }
    const having = this.eatKw('HAVING') ? this.expr() : null;
    if (this.isKw('WINDOW')) this.fail();
    return { k: 'core', distinct, cols, from, where, groupBy, having };
  }

  private valueRows(): Expr[][] {
    const rows: Expr[][] = [];
    do {
      this.op('(');
      rows.push(this.exprList());
      this.op(')');
    } while (this.eatOp(','));
    return rows;
  }

  private exprList(): Expr[] {
    const list = [this.expr()];
    while (this.eatOp(',')) list.push(this.expr());
    return list;
  }

  private resultCols(): ResultCol[] {
    const cols: ResultCol[] = [];
    do {
      const t = this.peek();
      if (this.isOp('*')) {
        this.i++;
        cols.push({ k: 'star', tbl: null, pos: t.start });
        continue;
      }
      if (this.isName() && this.isOp('.', 1) && this.isOp('*', 2)) {
        this.i += 3;
        cols.push({ k: 'star', tbl: t.value, pos: t.start });
        continue;
      }
      const e = this.expr();
      const span = this.sql.slice(t.start, this.prevEnd());
      let alias: string | null = null;
      if (this.eatKw('AS')) alias = this.name(true).value;
      else if (this.isName(0, true)) alias = this.advance().value;
      cols.push({ k: 'expr', e, alias, span });
    } while (this.eatOp(','));
    return cols;
  }

  private from(): FromItem[] {
    const items: FromItem[] = [this.fromItem('first', false)];
    for (;;) {
      if (this.eatOp(',')) {
        items.push(this.fromItem('cross', false));
        continue;
      }
      const natural = this.eatKw('NATURAL');
      let join: FromItem['join'] | null = null;
      if (this.eatKw('LEFT')) {
        this.eatKw('OUTER');
        join = 'left';
      } else if (this.isKw('RIGHT') || this.isKw('FULL')) {
        this.i++;
        throw parseError('RIGHT and FULL OUTER JOINs are not currently supported');
      } else if (this.eatKw('INNER')) join = 'inner';
      else if (this.eatKw('CROSS')) join = 'cross';
      if (join || natural || this.isKw('JOIN')) {
        this.kw('JOIN');
        const item = this.fromItem(join ?? 'inner', natural);
        if (this.eatKw('ON')) item.on = this.expr();
        else if (this.eatKw('USING')) {
          this.op('(');
          item.using = [];
          do item.using.push(this.name().value);
          while (this.eatOp(','));
          this.op(')');
        }
        items.push(item);
        continue;
      }
      break;
    }
    return items;
  }

  private fromItem(join: FromItem['join'], natural: boolean): FromItem {
    let src: FromItem['src'];
    if (this.isOp('(')) {
      this.i++;
      if (!this.isKw('SELECT') && !this.isKw('VALUES') && !this.isKw('WITH')) this.fail();
      src = { k: 'sub', sel: this.select() };
      this.op(')');
    } else {
      const t = this.tableName();
      if (this.isOp('(')) {
        this.i++;
        const args = this.isOp(')') ? [] : this.exprList();
        this.op(')');
        src = { k: 'tvf', name: t.name, args, pos: t.pos };
      } else {
        src = { k: 'table', t };
      }
    }
    let alias: string | null = null;
    if (this.eatKw('AS')) alias = this.name(true).value;
    else if (this.isName(0, true)) alias = this.advance().value;
    if (this.eatKw('INDEXED')) {
      this.kw('BY');
      this.name();
    } else if (this.isKw('NOT') && this.isKw('INDEXED', 1)) {
      this.i += 2;
    }
    return { src, alias, join, natural, on: null, using: null };
  }

  // ---- expressions ----------------------------------------------------------------------

  expr(): Expr {
    return this.orExpr();
  }

  private orExpr(): Expr {
    let l = this.andExpr();
    while (this.eatKw('OR')) l = { k: 'bin', op: 'OR', l, r: this.andExpr() };
    return l;
  }

  private andExpr(): Expr {
    let l = this.notExpr();
    while (this.eatKw('AND')) l = { k: 'bin', op: 'AND', l, r: this.notExpr() };
    return l;
  }

  private notExpr(): Expr {
    if (this.eatKw('NOT')) return { k: 'unary', op: 'NOT', e: this.notExpr() };
    return this.equality();
  }

  private equality(): Expr {
    let l = this.comparison();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && EQUALITY_OPS.has(t.value)) {
        this.i++;
        l = { k: 'bin', op: t.value === '==' ? '=' : t.value === '<>' ? '!=' : t.value, l, r: this.comparison() };
        continue;
      }
      if (this.eatKw('IS')) {
        const not = this.eatKw('NOT');
        if (this.eatKw('DISTINCT')) {
          this.kw('FROM');
          l = { k: 'bin', op: not ? 'IS' : 'IS NOT', l, r: this.comparison() };
        } else {
          l = { k: 'bin', op: not ? 'IS NOT' : 'IS', l, r: this.comparison() };
        }
        continue;
      }
      if (this.eatKw('ISNULL')) {
        l = { k: 'isnull', not: false, e: l };
        continue;
      }
      if (this.eatKw('NOTNULL')) {
        l = { k: 'isnull', not: true, e: l };
        continue;
      }
      let not = false;
      if (this.isKw('NOT')) {
        if (this.isKw('NULL', 1)) {
          this.i += 2;
          l = { k: 'isnull', not: true, e: l };
          continue;
        }
        const n = this.peek(1);
        if (n.type === 'id' && !n.quoted && ['LIKE', 'GLOB', 'REGEXP', 'MATCH', 'IN', 'BETWEEN'].includes(n.upper)) {
          this.i++;
          not = true;
        } else {
          break;
        }
      }
      const w = this.peek();
      if (w.type !== 'id' || w.quoted) {
        if (not) this.fail();
        break;
      }
      if (w.upper === 'LIKE' || w.upper === 'GLOB' || w.upper === 'REGEXP' || w.upper === 'MATCH') {
        this.i++;
        const r = this.comparison();
        const esc = this.eatKw('ESCAPE') ? this.comparison() : null;
        l = { k: 'like', op: w.upper, not, l, r, esc, pos: w.start };
        continue;
      }
      if (w.upper === 'BETWEEN') {
        this.i++;
        const lo = this.comparison();
        this.kw('AND');
        const hi = this.comparison();
        l = { k: 'between', not, e: l, lo, hi };
        continue;
      }
      if (w.upper === 'IN') {
        this.i++;
        if (this.eatOp('(')) {
          if (this.isKw('SELECT') || this.isKw('VALUES') || this.isKw('WITH')) {
            const sub = this.select();
            this.op(')');
            l = { k: 'in', not, e: l, list: null, sub };
          } else {
            const list = this.isOp(')') ? [] : this.exprList();
            this.op(')');
            l = { k: 'in', not, e: l, list, sub: null };
          }
        } else {
          const t = this.tableName();
          const sub: Select = {
            k: 'select', with: null, ops: [], orderBy: [], limit: null, offset: null,
            cores: [{ k: 'core', distinct: false, cols: [{ k: 'star', tbl: null, pos: t.pos }], from: [{ src: { k: 'table', t }, alias: null, join: 'first', natural: false, on: null, using: null }], where: null, groupBy: [], having: null }],
          };
          l = { k: 'in', not, e: l, list: null, sub };
        }
        continue;
      }
      if (not) this.fail();
      break;
    }
    return l;
  }

  private comparison(): Expr {
    let l = this.bitwise();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && COMPARE_OPS.has(t.value)) {
        this.i++;
        l = { k: 'bin', op: t.value, l, r: this.bitwise() };
      } else {
        return l;
      }
    }
  }

  private bitwise(): Expr {
    let l = this.additive();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '&' || t.value === '|' || t.value === '<<' || t.value === '>>')) {
        this.i++;
        l = { k: 'bin', op: t.value, l, r: this.additive() };
      } else {
        return l;
      }
    }
  }

  private additive(): Expr {
    let l = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.i++;
        l = { k: 'bin', op: t.value, l, r: this.multiplicative() };
      } else {
        return l;
      }
    }
  }

  private multiplicative(): Expr {
    let l = this.concat();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.i++;
        l = { k: 'bin', op: t.value, l, r: this.concat() };
      } else {
        return l;
      }
    }
  }

  private concat(): Expr {
    let l = this.collate();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '||') {
        this.i++;
        l = { k: 'bin', op: '||', l, r: this.collate() };
      } else if (t.type === 'op' && (t.value === '->' || t.value === '->>')) {
        this.fail(t);
      } else {
        return l;
      }
    }
  }

  private collate(): Expr {
    let e = this.unary();
    while (this.eatKw('COLLATE')) e = { k: 'collate', e, coll: this.name(true).value.toUpperCase() };
    return e;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+' || t.value === '~')) {
      this.i++;
      const e = this.unary();
      if (t.value === '-' && e.k === 'lit' && typeof e.v === 'number') return { k: 'lit', v: -e.v, real: e.real };
      return { k: 'unary', op: t.value as '-' | '+' | '~', e };
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.peek();
    switch (t.type) {
      case 'num': {
        this.i++;
        if (/^0x/i.test(t.value)) return { k: 'lit', v: parseInt(t.value, 16) };
        const real = /[.eE]/.test(t.value);
        return { k: 'lit', v: Number(t.value), real };
      }
      case 'str':
        this.i++;
        return { k: 'lit', v: t.value };
      case 'blob': {
        this.i++;
        let s = '';
        for (let j = 0; j < t.value.length; j += 2) s += String.fromCharCode(parseInt(t.value.slice(j, j + 2), 16));
        return { k: 'lit', v: s };
      }
      case 'var':
        throw parseError(`near "${t.value}": syntax error`, t.start);
      case 'op':
        if (t.value === '(') {
          this.i++;
          if (this.isKw('SELECT') || this.isKw('VALUES') || this.isKw('WITH')) {
            const sub = this.select();
            this.op(')');
            return { k: 'subq', sub };
          }
          const e = this.expr();
          if (this.isOp(',')) throw parseError('row value misused', t.start);
          this.op(')');
          return e;
        }
        return this.fail();
      case 'eof':
        return this.fail();
    }
    // identifiers and keywords
    if (!t.quoted) {
      switch (t.upper) {
        case 'NULL':
          this.i++;
          return { k: 'lit', v: null };
        case 'TRUE':
          this.i++;
          return { k: 'lit', v: 1 };
        case 'FALSE':
          this.i++;
          return { k: 'lit', v: 0 };
        case 'CURRENT_TIMESTAMP':
        case 'CURRENT_DATE':
        case 'CURRENT_TIME':
          this.i++;
          return { k: 'ctime', which: t.upper };
        case 'CASE':
          return this.caseExpr();
        case 'EXISTS': {
          this.i++;
          this.op('(');
          const sub = this.select();
          this.op(')');
          return { k: 'exists', sub };
        }
        case 'CAST':
          if (this.isOp('(', 1)) {
            this.i += 2;
            const e = this.expr();
            this.kw('AS');
            const type = this.typeName();
            this.op(')');
            return { k: 'cast', e, type };
          }
          break;
        case 'RAISE':
          return this.fail();
      }
      if (RESERVED.has(t.upper)) this.fail();
    }
    this.i++;
    if (this.isOp('(') && !t.quoted) return this.call(t);
    if (this.isOp('.')) {
      this.i++;
      const col = this.name(true);
      if (this.isOp('.')) {
        // schema.table.column
        this.i++;
        const c2 = this.name(true);
        return { k: 'col', tbl: col.value, name: c2.value, pos: t.start };
      }
      return { k: 'col', tbl: t.value, name: col.value, pos: t.start };
    }
    return { k: 'col', tbl: null, name: t.value, pos: t.start };
  }

  private call(nameTok: Token): Expr {
    this.op('(');
    let distinct = false;
    let star = false;
    let args: Expr[] = [];
    if (this.isOp('*')) {
      this.i++;
      star = true;
    } else if (!this.isOp(')')) {
      distinct = this.eatKw('DISTINCT');
      if (!distinct) this.eatKw('ALL');
      args = this.exprList();
      if (this.isKw('ORDER')) {
        // aggregate ORDER BY (group_concat(x ORDER BY y)): accepted, ignored
        this.i++;
        this.kw('BY');
        this.orderTerms();
      }
    }
    this.op(')');
    let filter: Expr | null = null;
    if (this.isKw('FILTER') && this.isOp('(', 1)) {
      this.i += 2;
      this.kw('WHERE');
      filter = this.expr();
      this.op(')');
    }
    let over: WindowSpec | null = null;
    if (this.isKw('OVER')) {
      this.i++;
      over = this.windowSpec();
    }
    return { k: 'fn', name: nameTok.value.toLowerCase(), args, star, distinct, pos: nameTok.start, filter, over };
  }

  private windowSpec(): WindowSpec {
    if (this.isName()) this.fail(); // named windows are not supported
    this.op('(');
    let partition: Expr[] = [];
    let order: OrderTerm[] = [];
    if (this.isKw('PARTITION')) {
      this.i++;
      this.kw('BY');
      partition = this.exprList();
    }
    if (this.isKw('ORDER')) {
      this.i++;
      this.kw('BY');
      order = this.orderTerms();
    }
    if (this.isKw('ROWS') || this.isKw('RANGE') || this.isKw('GROUPS')) this.fail();
    this.op(')');
    return { partition, order };
  }

  private caseExpr(): Expr {
    this.kw('CASE');
    const base = this.isKw('WHEN') ? null : this.expr();
    const whens: [Expr, Expr][] = [];
    while (this.eatKw('WHEN')) {
      const c = this.expr();
      this.kw('THEN');
      whens.push([c, this.expr()]);
    }
    if (whens.length === 0) this.fail();
    const els = this.eatKw('ELSE') ? this.expr() : null;
    this.kw('END');
    return { k: 'case', base, whens, els };
  }

  /** A type name such as INTEGER, VARCHAR(255), UNSIGNED BIG INT. Returns its text as typed. */
  private typeName(): string {
    const first = this.peek();
    let end = -1;
    while (this.peek().type === 'id' && (this.peek().quoted || !(TYPE_STOP.has(this.peek().upper) || RESERVED.has(this.peek().upper)))) {
      end = this.advance().end;
    }
    if (end < 0) return '';
    if (this.eatOp('(')) {
      const num = () => {
        if (this.isOp('-') || this.isOp('+')) this.i++;
        const t = this.advance();
        if (t.type !== 'num') this.fail(t);
      };
      num();
      if (this.eatOp(',')) num();
      this.op(')');
      end = this.prevEnd();
    }
    return this.sql.slice(first.start, end);
  }

  // ---- INSERT / UPDATE / DELETE ---------------------------------------------------------

  private conflict(): Conflict {
    const t = this.advance();
    if (t.type === 'id' && !t.quoted && ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'].includes(t.upper)) return t.upper as Conflict;
    return this.fail(t);
  }

  private returning(): ResultCol[] | null {
    return this.eatKw('RETURNING') ? this.resultCols() : null;
  }

  private insert(withs: Cte[] | null): Stmt {
    let or: Conflict | null = null;
    if (this.eatKw('REPLACE')) or = 'REPLACE';
    else {
      this.kw('INSERT');
      if (this.eatKw('OR')) or = this.conflict();
    }
    this.kw('INTO');
    const table = this.tableName();
    const alias = this.eatKw('AS') ? this.name().value : null;
    let cols: { name: string; pos: number }[] | null = null;
    if (this.eatOp('(')) {
      cols = [];
      do {
        const t = this.name(true);
        cols.push({ name: t.value, pos: t.start });
      } while (this.eatOp(','));
      this.op(')');
    }
    let values: Expr[][] | null = null;
    let sel: Select | null = null;
    if (this.isKw('DEFAULT')) {
      this.i++;
      this.kw('VALUES');
      values = [];
    } else if (this.isKw('VALUES')) {
      this.i++;
      values = this.valueRows();
    } else if (this.isKw('SELECT') || this.isKw('WITH')) {
      sel = this.select();
    } else {
      this.fail();
    }
    const upsert: Upsert[] = [];
    while (this.isKw('ON') && this.isKw('CONFLICT', 1)) {
      this.i += 2;
      let target: string[] | null = null;
      if (this.eatOp('(')) {
        target = [];
        do {
          target.push(this.name().value);
          if (this.eatKw('COLLATE')) this.name();
          if (!this.eatKw('ASC')) this.eatKw('DESC');
        } while (this.eatOp(','));
        this.op(')');
        if (this.eatKw('WHERE')) this.expr();
      }
      this.kw('DO');
      if (this.eatKw('NOTHING')) {
        upsert.push({ target, sets: null, where: null });
        continue;
      }
      this.kw('UPDATE');
      this.kw('SET');
      const sets = this.setClauses();
      const where = this.eatKw('WHERE') ? this.expr() : null;
      upsert.push({ target, sets, where });
    }
    return { k: 'insert', with: withs, or, table, alias, cols, values, sel, upsert, returning: this.returning() };
  }

  private setClauses(): SetClause[] {
    const sets: SetClause[] = [];
    do {
      if (this.eatOp('(')) {
        const cols: { name: string; pos: number }[] = [];
        do {
          const t = this.name(true);
          cols.push({ name: t.value, pos: t.start });
        } while (this.eatOp(','));
        this.op(')');
        this.op('=');
        this.op('(');
        const values = this.exprList();
        this.op(')');
        if (values.length !== cols.length) throw parseError(`${cols.length} columns assigned ${values.length} values`);
        cols.forEach((c, j) => sets.push({ cols: [c], e: values[j] }));
        continue;
      }
      const t = this.name(true);
      if (this.isOp('.')) this.fail();
      this.op('=');
      sets.push({ cols: [{ name: t.value, pos: t.start }], e: this.expr() });
    } while (this.eatOp(','));
    return sets;
  }

  private update(withs: Cte[] | null): Stmt {
    this.kw('UPDATE');
    const or = this.eatKw('OR') ? this.conflict() : null;
    const table = this.tableName();
    let alias: string | null = null;
    if (this.eatKw('AS')) alias = this.name().value;
    else if (this.isName() && !this.isKw('SET')) alias = this.advance().value;
    this.kw('SET');
    const sets = this.setClauses();
    const from = this.eatKw('FROM') ? this.from() : [];
    const where = this.eatKw('WHERE') ? this.expr() : null;
    return { k: 'update', with: withs, or, table, alias, sets, from, where, returning: this.returning() };
  }

  private delete(withs: Cte[] | null): Stmt {
    this.kw('DELETE');
    this.kw('FROM');
    const table = this.tableName();
    let alias: string | null = null;
    if (this.eatKw('AS')) alias = this.name().value;
    else if (this.isName() && !this.isKw('RETURNING')) alias = this.advance().value;
    const where = this.eatKw('WHERE') ? this.expr() : null;
    return { k: 'delete', with: withs, table, alias, where, returning: this.returning() };
  }

  // ---- DDL ------------------------------------------------------------------------------

  private ifNotExists(): boolean {
    if (this.isKw('IF') && this.isKw('NOT', 1)) {
      this.i += 2;
      this.kw('EXISTS');
      return true;
    }
    return false;
  }

  private create(): Stmt {
    this.kw('CREATE');
    if (this.eatKw('TEMP') || this.eatKw('TEMPORARY')) {
      if (!this.isKw('TABLE') && !this.isKw('VIEW')) this.fail();
    }
    if (this.eatKw('TABLE')) {
      const ifNot = this.ifNotExists();
      const table = this.tableName();
      if (this.eatKw('AS')) {
        const asSel = this.select();
        return { k: 'createTable', ifNot, table, asSel, sql: '' };
      }
      const nameStart = table.pos;
      this.tableBody();
      return { k: 'createTable', ifNot, table, asSel: null, sql: 'CREATE TABLE ' + this.sql.slice(nameStart, this.prevEnd()) };
    }
    const unique = this.eatKw('UNIQUE');
    if (this.eatKw('INDEX')) {
      const ifNot = this.ifNotExists();
      const name = this.tableName();
      this.kw('ON');
      const table = this.tableName();
      this.op('(');
      const cols: { e: Expr; pos: number }[] = [];
      do {
        const pos = this.peek().start;
        cols.push({ e: this.expr(), pos });
        if (!this.eatKw('ASC')) this.eatKw('DESC');
      } while (this.eatOp(','));
      this.op(')');
      const where = this.eatKw('WHERE') ? this.expr() : null;
      const sql = `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ` + this.sql.slice(name.pos, this.prevEnd());
      return { k: 'createIndex', ifNot, unique, name, table, cols, where, sql };
    }
    if (unique) this.fail();
    if (this.eatKw('VIEW')) {
      const ifNot = this.ifNotExists();
      const name = this.tableName();
      let cols: string[] | null = null;
      if (this.eatOp('(')) {
        cols = [];
        do cols.push(this.name().value);
        while (this.eatOp(','));
        this.op(')');
      }
      this.kw('AS');
      const sel = this.select();
      return { k: 'createView', ifNot, name, cols, sel, sql: 'CREATE VIEW ' + this.sql.slice(name.pos, this.prevEnd()) };
    }
    return this.fail();
  }

  /** The definition in a stored `CREATE TABLE name (...)`. */
  createTableDef(): TableDef {
    this.kw('CREATE');
    this.kw('TABLE');
    this.tableName();
    return this.tableBody();
  }

  /** `( column-defs, constraints ) [options]` of CREATE TABLE. */
  private tableBody(): TableDef {
    this.op('(');
    const cols: ColumnDef[] = [];
    const constraints: TableConstraint[] = [];
    do {
      if (this.isKw('CONSTRAINT') || this.isKw('PRIMARY') || this.isKw('UNIQUE') || this.isKw('CHECK') || this.isKw('FOREIGN')) {
        constraints.push(this.tableConstraint());
      } else {
        if (constraints.length) this.fail();
        cols.push(this.columnDef());
      }
    } while (this.eatOp(','));
    const close = this.peek().start;
    this.op(')');
    while (this.isKw('WITHOUT') || this.isKw('STRICT')) {
      if (this.eatKw('WITHOUT')) {
        const t = this.name();
        if (t.upper !== 'ROWID') this.fail(t);
      } else this.i++;
      if (!this.eatOp(',')) break;
    }
    return { cols, constraints, close };
  }

  private nameList(): NameRef[] {
    this.op('(');
    const out: NameRef[] = [];
    do {
      const t = this.name(true);
      out.push({ name: t.value, start: t.start, end: t.end });
      if (this.eatKw('COLLATE')) this.name();
      if (!this.eatKw('ASC')) this.eatKw('DESC');
    } while (this.eatOp(','));
    this.op(')');
    return out;
  }

  private conflictClause(): void {
    if (this.isKw('ON') && this.isKw('CONFLICT', 1)) {
      this.i += 2;
      this.conflict();
    }
  }

  private references(): void {
    this.kw('REFERENCES');
    this.name(true);
    if (this.isOp('(')) this.nameList();
    for (;;) {
      if (this.isKw('ON') && (this.isKw('DELETE', 1) || this.isKw('UPDATE', 1))) {
        this.i += 2;
        if (this.eatKw('SET')) {
          if (!this.eatKw('NULL')) this.kw('DEFAULT');
        } else if (this.eatKw('NO')) this.kw('ACTION');
        else if (!this.eatKw('CASCADE') && !this.eatKw('RESTRICT')) this.fail();
        continue;
      }
      if (this.eatKw('MATCH')) {
        this.name();
        continue;
      }
      break;
    }
    if (this.isKw('NOT') && this.isKw('DEFERRABLE', 1)) this.i += 2;
    else this.eatKw('DEFERRABLE');
    if (this.eatKw('INITIALLY')) {
      if (!this.eatKw('DEFERRED')) this.kw('IMMEDIATE');
    }
  }

  private tableConstraint(): TableConstraint {
    if (this.eatKw('CONSTRAINT')) this.name(true);
    if (this.eatKw('PRIMARY')) {
      this.kw('KEY');
      const cols = this.nameList();
      this.conflictClause();
      return { k: 'pk', cols };
    }
    if (this.eatKw('UNIQUE')) {
      const cols = this.nameList();
      this.conflictClause();
      return { k: 'unique', cols };
    }
    if (this.eatKw('CHECK')) {
      this.op('(');
      this.expr();
      this.op(')');
      return { k: 'other', cols: [] };
    }
    this.kw('FOREIGN');
    this.kw('KEY');
    const cols = this.nameList();
    this.references();
    return { k: 'other', cols };
  }

  columnDef(): ColumnDef {
    const nameTok = this.name(true);
    const def: ColumnDef = {
      name: nameTok.value, nameStart: nameTok.start, nameEnd: nameTok.end, start: nameTok.start, end: nameTok.end,
      type: this.typeName(), pk: null, notNull: false, unique: false, dflt: null, dfltText: null, coll: null,
    };
    for (;;) {
      if (this.eatKw('CONSTRAINT')) this.name(true);
      if (this.eatKw('PRIMARY')) {
        this.kw('KEY');
        const desc = this.eatKw('DESC');
        if (!desc) this.eatKw('ASC');
        this.conflictClause();
        const autoinc = this.eatKw('AUTOINCREMENT');
        if (def.pk) throw parseError(`table has more than one primary key`);
        def.pk = { desc, autoinc };
      } else if (this.isKw('NOT') && this.isKw('NULL', 1)) {
        this.i += 2;
        this.conflictClause();
        def.notNull = true;
      } else if (this.eatKw('NULL')) {
        this.conflictClause();
      } else if (this.eatKw('UNIQUE')) {
        this.conflictClause();
        def.unique = true;
      } else if (this.eatKw('CHECK')) {
        this.op('(');
        this.expr();
        this.op(')');
      } else if (this.eatKw('DEFAULT')) {
        const t = this.peek();
        if (this.eatOp('(')) {
          const inner = this.peek().start;
          def.dflt = this.expr();
          def.dfltText = this.sql.slice(inner, this.prevEnd());
          this.op(')');
        } else if (this.isOp('-') || this.isOp('+')) {
          this.i++;
          const n = this.advance();
          if (n.type !== 'num') this.fail(n);
          def.dflt = { k: 'lit', v: (t.value === '-' ? -1 : 1) * Number(n.value), real: /[.eE]/.test(n.value) };
          def.dfltText = this.sql.slice(t.start, n.end);
        } else if (t.type === 'num' || t.type === 'str' || t.type === 'blob' || (t.type === 'id' && !t.quoted && ['NULL', 'TRUE', 'FALSE', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].includes(t.upper))) {
          def.dflt = this.primary();
          def.dfltText = this.sql.slice(t.start, t.end);
        } else if (t.type === 'id' && (t.quoted || !RESERVED.has(t.upper))) {
          this.i++;
          def.dflt = { k: 'lit', v: t.value };
          def.dfltText = this.sql.slice(t.start, t.end);
        } else {
          this.fail();
        }
      } else if (this.eatKw('COLLATE')) {
        def.coll = this.name(true).value.toUpperCase();
      } else if (this.isKw('REFERENCES')) {
        this.references();
      } else if (this.isKw('GENERATED') || this.isKw('AS')) {
        this.fail();
      } else {
        break;
      }
    }
    def.end = this.prevEnd();
    return def;
  }

  private drop(): Stmt {
    this.kw('DROP');
    const w = this.peek();
    if (!this.eatKw('TABLE') && !this.eatKw('INDEX') && !this.eatKw('VIEW')) this.fail();
    let ifExists = false;
    if (this.isKw('IF')) {
      this.i++;
      this.kw('EXISTS');
      ifExists = true;
    }
    return { k: 'drop', what: w.upper as 'TABLE' | 'INDEX' | 'VIEW', ifExists, name: this.tableName() };
  }

  private alter(): Stmt {
    this.kw('ALTER');
    this.kw('TABLE');
    const table = this.tableName();
    let action: AlterAction;
    if (this.eatKw('RENAME')) {
      if (this.eatKw('TO')) {
        action = { k: 'rename', to: this.name(true).value };
      } else {
        this.eatKw('COLUMN');
        const from = this.name(true).value;
        this.kw('TO');
        const t = this.name(true);
        action = { k: 'renameCol', from, to: t.value, toQuoted: t.quoted };
      }
    } else if (this.eatKw('ADD')) {
      this.eatKw('COLUMN');
      const start = this.peek().start;
      this.columnDef();
      action = { k: 'add', text: this.sql.slice(start, this.prevEnd()) };
    } else if (this.eatKw('DROP')) {
      this.eatKw('COLUMN');
      action = { k: 'dropCol', name: this.name(true).value };
    } else {
      return this.fail();
    }
    return { k: 'alter', table, action };
  }
}

/** Parse a stored `CREATE TABLE name (...)` statement into its definition. */
export function parseTableDef(sql: string): TableDef {
  return new Parser(sql).createTableDef();
}

/** Parse a single column definition, as given to ALTER TABLE ADD COLUMN. */
export function parseColumnDef(text: string): ColumnDef {
  return new Parser(text).columnDef();
}

/** Parse a stored CREATE VIEW statement's SELECT. */
export function parseViewSelect(sql: string): { cols: string[] | null; sel: Select } {
  const p = new Parser(sql);
  const st = p.next()!.stmt;
  if (st.k !== 'createView') throw parseError('malformed view');
  return { cols: st.cols, sel: st.sel };
}
