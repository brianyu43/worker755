import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell, Database, SqlError } from '../src/index.ts';
import { NOW } from './helpers.ts';

const DUMP = `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, plan TEXT DEFAULT 'free');
INSERT INTO users VALUES(1,'dana@billosarus.io','Dana Whitfield','enterprise');
INSERT INTO users VALUES(2,'ops@example.com',NULL,'free');
COMMIT;
`;

const DB = '/srv/billosaurus/db/prod.db';

/** A shell with prod.db in place, cwd next to it, and a clock that can move. */
function setup(text = DUMP) {
  let now = NOW;
  const sh = createShell({ now: () => now });
  sh.exec('mkdir -p /srv/billosaurus/db');
  sh.fs.writeFile(DB, text);
  sh.cwd = '/srv/billosaurus/db';
  const run = (line: string) => sh.exec(line);
  const file = () => sh.fs.readFile(DB);
  const tick = () => (now += 60_000);
  return { sh, run, file, tick };
}

function expect(r: { stdout: string; stderr: string; exitCode: number }, stdout: string, stderr = '', exitCode = stderr ? 1 : 0) {
  assert.equal(r.stdout, stdout);
  assert.equal(r.stderr, stderr);
  assert.equal(r.exitCode, exitCode);
}

function rows(db: Database, sql: string) {
  return db.query(sql).rows;
}

// ---- Database API ---------------------------------------------------------------------------

test('dump round-trips the stored text', () => {
  const db = Database.load(DUMP);
  assert.equal(db.dump(), DUMP);
  assert.deepEqual(db.tableNames(), ['users']);
  assert.deepEqual(db.table('USERS'), {
    columns: ['id', 'email', 'name', 'plan'],
    rows: [
      [1, 'dana@billosarus.io', 'Dana Whitfield', 'enterprise'],
      [2, 'ops@example.com', null, 'free'],
    ],
  });
  assert.equal(db.table('nope'), null);
});

test('load: empty text, plain scripts, strings with quotes and newlines', () => {
  assert.equal(Database.load('').dump(), 'PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCOMMIT;\n');
  const db = Database.load("create table t(a, b text);\ninsert into t values (1, 'it''s\nfine'), (2.5, NULL);");
  assert.equal(
    db.dump(),
    "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE t(a, b text);\nINSERT INTO t VALUES(1,'it''s\nfine');\nINSERT INTO t VALUES(2.5,NULL);\nCOMMIT;\n",
  );
  assert.equal(Database.load(db.dump()).dump(), db.dump());
});

test('load: text that does not run is not a database', () => {
  for (const text of ['hello world', 'SELECT * FROM nope;', "INSERT INTO t VALUES('unterminated"]) {
    assert.throws(() => Database.load(text), (e: unknown) => e instanceof SqlError && e.message === 'file is not a database' && e.code === 26);
  }
});

test('exec returns one result per row-returning statement; errors keep earlier statements', () => {
  const db = Database.load(DUMP);
  const rs = db.exec("SELECT count(*) FROM users; UPDATE users SET plan = 'pro' WHERE id = 2; SELECT plan FROM users WHERE id = 2;");
  assert.deepEqual(rs, [
    { columns: ['count(*)'], rows: [[2]] },
    { columns: ['plan'], rows: [['pro']] },
  ]);
  assert.throws(() => db.exec("UPDATE users SET plan = 'x' WHERE id = 1; SELECT nope FROM users;"), /no such column: nope/);
  assert.deepEqual(rows(db, 'SELECT plan FROM users WHERE id = 1'), [['x']]);
  assert.deepEqual(db.query('DELETE FROM users WHERE 0'), { columns: [], rows: [] });
  try {
    db.exec('SELECT * FROM userz');
    assert.fail('should throw');
  } catch (e) {
    if (!(e instanceof SqlError)) throw e;
    assert.equal(e.kind, 'parse');
    assert.equal(e.message, 'no such table: userz');
  }
});

test('UPDATE and DELETE with and without WHERE', () => {
  const db = Database.load(DUMP);
  db.exec("UPDATE users SET plan = 'pro' WHERE email = 'ops@example.com'");
  assert.deepEqual(rows(db, 'SELECT id, plan FROM users'), [[1, 'enterprise'], [2, 'pro']]);
  db.exec("UPDATE users SET name = 'Nobody'");
  assert.deepEqual(rows(db, 'SELECT name FROM users'), [['Nobody'], ['Nobody']]);
  assert.deepEqual(rows(db, 'SELECT changes()'), [[2]]);
  db.exec('DELETE FROM users WHERE id = 1');
  assert.deepEqual(rows(db, 'SELECT id FROM users'), [[2]]);
  db.exec('DELETE FROM users');
  assert.deepEqual(rows(db, 'SELECT count(*) FROM users'), [[0]]);
});

test('DELETE with IN (SELECT ...) and with a scalar subquery', () => {
  const db = Database.load(DUMP);
  db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL); INSERT INTO orders (user_id, total) VALUES (1, 10.5), (2, 3), (2, 4), (3, 1);");
  db.exec('DELETE FROM orders WHERE user_id NOT IN (SELECT id FROM users)');
  assert.deepEqual(rows(db, 'SELECT id FROM orders'), [[1], [2], [3]]);
  db.exec('DELETE FROM orders WHERE total = (SELECT max(total) FROM orders)');
  assert.deepEqual(rows(db, 'SELECT id, total FROM orders'), [[2, 3], [3, 4]]);
  db.exec('DELETE FROM users WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = users.id)');
  assert.deepEqual(rows(db, 'SELECT id FROM users'), [[2]]);
});

test('SELECT: joins, grouping, ordering, limits', () => {
  const db = Database.load(DUMP);
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total REAL, status TEXT);
    INSERT INTO orders (user_id, total, status) VALUES (1, 100, 'paid'), (1, 50.5, 'paid'), (2, 7, 'refunded'), (2, 3, 'paid');`);
  assert.deepEqual(
    rows(db, 'SELECT u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE o.total > 5 ORDER BY o.total DESC'),
    [['dana@billosarus.io', 100], ['dana@billosarus.io', 50.5], ['ops@example.com', 7]],
  );
  assert.deepEqual(
    db.query('SELECT u.plan, COUNT(*) AS n, SUM(o.total) total FROM users u, orders o WHERE o.user_id = u.id GROUP BY u.plan ORDER BY total DESC'),
    { columns: ['plan', 'n', 'total'], rows: [['enterprise', 2, 150.5], ['free', 2, 10]] },
  );
  db.exec("INSERT INTO users (email) VALUES ('new@example.com')");
  assert.deepEqual(
    rows(db, 'SELECT u.id, count(o.id) FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id HAVING count(o.id) < 2 ORDER BY 1'),
    [[3, 0]],
  );
  assert.deepEqual(rows(db, 'SELECT id FROM orders ORDER BY total LIMIT 2 OFFSET 1'), [[3], [2]]);
  assert.deepEqual(rows(db, 'SELECT id FROM orders ORDER BY total LIMIT 1, 2'), [[3], [2]]);
  assert.deepEqual(rows(db, 'SELECT DISTINCT status FROM orders ORDER BY status'), [['paid'], ['refunded']]);
  assert.deepEqual(rows(db, 'SELECT count(DISTINCT user_id), avg(total), min(total), max(total), total(total) FROM orders'), [[2, 40.125, 3, 100, 160.5]]);
  assert.deepEqual(rows(db, 'SELECT email, max(total) FROM users JOIN orders ON users.id = orders.user_id'), [['dana@billosarus.io', 100]]);
  assert.deepEqual(rows(db, "SELECT group_concat(id, ';') FROM orders WHERE status = 'paid'"), [['1;2;4']]);
  assert.deepEqual(rows(db, 'SELECT o.* FROM orders o WHERE id = 4'), [[4, 2, 3, 'paid']]);
  assert.deepEqual(rows(db, 'SELECT 1 + 1, 7 / 2, 7.0 / 2, 7 % 3, 1 / 0'), [[2, 3, 3.5, 1, null]]);
  assert.deepEqual(rows(db, "SELECT id FROM users UNION SELECT user_id FROM orders ORDER BY 1 DESC"), [[3], [2], [1]]);
  assert.deepEqual(rows(db, 'WITH big AS (SELECT * FROM orders WHERE total > 5) SELECT count(*) FROM big'), [[3]]);
  assert.deepEqual(rows(db, 'SELECT id, rank() OVER (ORDER BY total DESC) FROM orders ORDER BY id'), [[1, 1], [2, 2], [3, 3], [4, 4]]);
});

test('equality joins give the same rows as a plain nested loop', () => {
  const db = Database.load(`CREATE TABLE a (id INTEGER PRIMARY KEY, code TEXT, k);
    INSERT INTO a (code, k) VALUES ('1', 1), ('2', NULL), ('x', 'x'), (NULL, 2), ('1', '1');
    CREATE TABLE b (id INTEGER PRIMARY KEY, n INTEGER, t TEXT COLLATE NOCASE);
    INSERT INTO b (n, t) VALUES (1, 'X'), (2, '1'), (NULL, NULL), (1, 'x');`);
  const pairs = [
    ['SELECT a.id, b.id FROM a JOIN b ON b.n = a.code', 'SELECT a.id, b.id FROM a JOIN b ON (b.n = a.code OR 0)'],
    ['SELECT a.id, b.id FROM a LEFT JOIN b ON b.t = a.code ORDER BY 1, 2', 'SELECT a.id, b.id FROM a LEFT JOIN b ON (b.t = a.code OR 0) ORDER BY 1, 2'],
    ['SELECT a.id, b.id FROM a, b WHERE a.k = b.n AND b.id > 1', 'SELECT a.id, b.id FROM a, b WHERE (a.k = b.n OR 0) AND b.id > 1'],
    ['SELECT a.id FROM a WHERE EXISTS (SELECT 1 FROM b WHERE b.t = a.code)', 'SELECT a.id FROM a WHERE EXISTS (SELECT 1 FROM b WHERE (b.t = a.code OR 0))'],
  ];
  for (const [fast, slow] of pairs) assert.deepEqual(rows(db, fast), rows(db, slow), fast);
  assert.deepEqual(rows(db, 'SELECT a.id, b.id FROM a JOIN b ON b.n = a.code'), [[1, 1], [1, 4], [2, 2], [5, 1], [5, 4]]);
  assert.deepEqual(rows(db, "SELECT a.id FROM a JOIN b ON b.t = a.code WHERE b.id = 1"), [[3]]);
});

test('WITH RECURSIVE', () => {
  const db = Database.load("CREATE TABLE emp (id INTEGER PRIMARY KEY, boss INTEGER, name TEXT); INSERT INTO emp VALUES (1, NULL, 'ceo'), (2, 1, 'vp'), (3, 2, 'dev');");
  assert.deepEqual(
    rows(db, 'WITH RECURSIVE up(id, depth) AS (SELECT 3, 0 UNION ALL SELECT e.boss, up.depth + 1 FROM up JOIN emp e ON e.id = up.id WHERE e.boss IS NOT NULL) SELECT id, depth FROM up'),
    [[3, 0], [2, 1], [1, 2]],
  );
  assert.deepEqual(rows(db, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 4) SELECT sum(x) FROM c'), [[10]]);
});

test('INSERT: auto ids, defaults, constraints, OR IGNORE / OR REPLACE', () => {
  const db = Database.load(DUMP);
  db.exec("INSERT INTO users (email, name) VALUES ('a@x.io', 'A'), ('b@x.io', 'B')");
  assert.deepEqual(rows(db, 'SELECT id, email, plan FROM users WHERE id > 2'), [[3, 'a@x.io', 'free'], [4, 'b@x.io', 'free']]);
  assert.deepEqual(rows(db, 'SELECT last_insert_rowid()'), [[4]]);
  db.exec("INSERT INTO users VALUES (NULL, 'c@x.io', NULL, 'pro'), ('10', 'd@x.io', NULL, 'pro')");
  assert.deepEqual(rows(db, 'SELECT id FROM users WHERE id > 4'), [[5], [10]]);
  assert.throws(() => db.exec("INSERT INTO users (email) VALUES ('ops@example.com')"), /^SqlError: UNIQUE constraint failed: users\.email$/);
  assert.throws(() => db.exec("INSERT INTO users (id, email) VALUES (1, 'z@x.io')"), /UNIQUE constraint failed: users\.id/);
  assert.throws(() => db.exec("INSERT INTO users (name) VALUES ('x')"), /NOT NULL constraint failed: users\.email/);
  assert.throws(() => db.exec("INSERT INTO users VALUES (1, 2)"), /table users has 4 columns but 2 values were supplied/);
  assert.throws(() => db.exec("INSERT INTO users (nope) VALUES (1)"), /table users has no column named nope/);
  assert.throws(() => db.exec("INSERT INTO users (id, email) VALUES ('abc', 'q@x.io')"), /datatype mismatch/);
  // a failing multi-row INSERT leaves nothing behind
  assert.throws(() => db.exec("INSERT INTO users (email) VALUES ('ok@x.io'), ('a@x.io')"), /UNIQUE/);
  assert.deepEqual(rows(db, "SELECT count(*) FROM users WHERE email = 'ok@x.io'"), [[0]]);
  db.exec("INSERT OR IGNORE INTO users (email, name) VALUES ('a@x.io', 'ignored')");
  assert.deepEqual(rows(db, "SELECT name FROM users WHERE email = 'a@x.io'"), [['A']]);
  db.exec("INSERT OR REPLACE INTO users (id, email, name) VALUES (3, 'a@x.io', 'replaced')");
  assert.deepEqual(rows(db, 'SELECT name, plan FROM users WHERE id = 3'), [['replaced', 'free']]);
  db.exec("INSERT INTO users (email, name) VALUES ('a@x.io', 'up') ON CONFLICT(email) DO UPDATE SET name = excluded.name");
  assert.deepEqual(rows(db, 'SELECT name FROM users WHERE id = 3'), [['up']]);
  // AUTOINCREMENT keeps counting after deletes and shows up in the dump
  db.exec('CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT); INSERT INTO log (msg) VALUES (1), (2); DELETE FROM log;');
  db.exec("INSERT INTO log (msg) VALUES ('x')");
  assert.deepEqual(rows(db, 'SELECT id, msg FROM log'), [[3, 'x']]);
  assert.match(db.dump(), /DELETE FROM sqlite_sequence;\nINSERT INTO sqlite_sequence VALUES\('log',3\);\nCOMMIT;\n$/);
  assert.equal(Database.load(db.dump()).dump(), db.dump());
});

test('UPDATE is atomic: a constraint failure half-way changes nothing', () => {
  const db = Database.load(DUMP);
  assert.throws(() => db.exec('UPDATE users SET id = id + 1'), /UNIQUE constraint failed: users\.id/);
  assert.deepEqual(rows(db, 'SELECT id FROM users'), [[1], [2]]);
  assert.throws(() => db.exec("UPDATE users SET email = 'same@x.io'"), /UNIQUE constraint failed: users\.email/);
  assert.throws(() => db.exec('UPDATE users SET email = NULL WHERE id = 2'), /NOT NULL constraint failed: users\.email/);
  db.exec('UPDATE users SET id = id + 10');
  assert.deepEqual(rows(db, 'SELECT id FROM users'), [[11], [12]]);
});

test('affinity, comparisons and NULL logic', () => {
  const db = Database.load(DUMP);
  assert.deepEqual(rows(db, "SELECT email FROM users WHERE id = '2'"), [['ops@example.com']]);
  assert.deepEqual(rows(db, 'SELECT count(*) FROM users WHERE name = NULL'), [[0]]);
  assert.deepEqual(rows(db, 'SELECT count(*) FROM users WHERE name IS NULL'), [[1]]);
  assert.deepEqual(rows(db, "SELECT count(*) FROM users WHERE name != 'x'"), [[1]]);
  assert.deepEqual(rows(db, 'SELECT NULL AND 0, NULL OR 1, NOT NULL, 1 IN (NULL, 2), 2 IN (NULL, 2)'), [[0, 1, null, null, 1]]);
  assert.deepEqual(rows(db, "SELECT 'ABC' LIKE 'a%', 'abc' GLOB 'A*', 'a_c' LIKE 'a!_c' ESCAPE '!', 5 BETWEEN 1 AND 5"), [[1, 0, 1, 1]]);
  assert.deepEqual(rows(db, "SELECT 1 < 'a', NULL < 1, 10 < 9, '10' < '9'"), [[1, null, 0, 1]]);
  assert.deepEqual(rows(db, "SELECT CASE WHEN id = 1 THEN 'one' ELSE 'other' END, CAST('12abc' AS INTEGER), CAST(3.9 AS INTEGER) FROM users"), [['one', 12, 3], ['other', 12, 3]]);
  db.exec("CREATE TABLE t (n INTEGER, s TEXT, r REAL); INSERT INTO t VALUES ('42', 42, '1.5');");
  assert.deepEqual(rows(db, 'SELECT typeof(n), typeof(s), typeof(r), n, s, r FROM t'), [['integer', 'text', 'real', 42, '42', 1.5]]);
  assert.deepEqual(rows(db, 'SELECT count(*) FROM t WHERE s = 42'), [[1]]);
});

test('functions', () => {
  const db = Database.load('', { now: () => NOW });
  assert.deepEqual(
    rows(db, "SELECT lower('AbC'), upper('abc'), length('héllo'), substr('abcdef', 2, 3), substr('abcdef', -2), trim('  x  '), replace('a-b-c', '-', '+'), instr('hello', 'l')"),
    [['abc', 'ABC', 5, 'bcd', 'ef', 'x', 'a+b+c', 3]],
  );
  assert.deepEqual(
    rows(db, "SELECT coalesce(NULL, NULL, 3), ifnull(NULL, 'd'), nullif(1, 1), abs(-4), round(2.567, 2), round(2.5), max(1, 5, 3), min('b', 'a'), typeof(NULL), typeof(1.0)"),
    [[3, 'd', null, 4, 2.57, 3, 5, 'a', 'null', 'real']],
  );
  assert.deepEqual(rows(db, "SELECT printf('%5.2f|%-4s|%03d|%s', 3.14159, 'ab', 7, NULL)"), [[' 3.14|ab  |007|']]);
  assert.deepEqual(
    rows(db, "SELECT date('now'), time('now'), datetime('now'), datetime('now', '-30 days'), date('2024-02-28', '+1 day'), strftime('%Y-%m', 'now'), date('now', 'start of month')"),
    [['2026-11-11', '10:49:00', '2026-11-11 10:49:00', '2026-10-12 10:49:00', '2024-02-29', '2026-11', '2026-11-01']],
  );
  assert.deepEqual(rows(db, 'SELECT CURRENT_DATE, typeof(random())'), [['2026-11-11', 'integer']]);
  assert.throws(() => db.exec('SELECT nosuch(1)'), /no such function: nosuch/);
  assert.throws(() => db.exec("SELECT lower('a', 'b')"), /wrong number of arguments to function lower\(\)/);
  assert.throws(() => db.exec('CREATE TABLE t(a); SELECT a FROM t WHERE count(*) > 1'), /misuse of aggregate: count\(\)/);
});

test('DDL: CREATE AS SELECT, ALTER, DROP, indexes, sqlite_master, PRAGMA table_info', () => {
  const db = Database.load(DUMP);
  db.exec('CREATE TABLE users_backup AS SELECT * FROM users');
  assert.equal(db.schema()[1].sql, 'CREATE TABLE users_backup(\n  id INT,\n  email TEXT,\n  name TEXT,\n  "plan" TEXT\n)');
  assert.deepEqual(rows(db, 'SELECT * FROM users_backup'), rows(db, 'SELECT * FROM users'));
  db.exec('DELETE FROM users_backup; INSERT INTO users_backup SELECT * FROM users WHERE id = 2');
  assert.deepEqual(rows(db, 'SELECT id FROM users_backup'), [[2]]);
  db.exec('ALTER TABLE users ADD COLUMN churned INTEGER NOT NULL DEFAULT 0');
  assert.equal(db.schema()[0].sql, "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, plan TEXT DEFAULT 'free', churned INTEGER NOT NULL DEFAULT 0)");
  assert.match(db.dump(), /INSERT INTO users VALUES\(2,'ops@example.com',NULL,'free',0\);/);
  db.exec('ALTER TABLE users RENAME COLUMN name TO full_name');
  assert.deepEqual(db.table('users')!.columns, ['id', 'email', 'full_name', 'plan', 'churned']);
  db.exec('CREATE INDEX idx_users_plan ON users (plan)');
  db.exec('ALTER TABLE users RENAME TO customers');
  assert.deepEqual(db.tableNames(), ['customers', 'users_backup']);
  assert.deepEqual(
    rows(db, 'SELECT type, name, tbl_name, sql FROM sqlite_master'),
    [
      ['table', 'customers', 'customers', `CREATE TABLE "customers" (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, full_name TEXT, plan TEXT DEFAULT 'free', churned INTEGER NOT NULL DEFAULT 0)`],
      ['index', 'sqlite_autoindex_customers_1', 'customers', null],
      ['table', 'users_backup', 'users_backup', db.schema()[1].sql],
      ['index', 'idx_users_plan', 'customers', 'CREATE INDEX idx_users_plan ON "customers" (plan)'],
    ],
  );
  assert.deepEqual(rows(db, "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"), [['customers'], ['users_backup']]);
  assert.deepEqual(db.query('PRAGMA table_info(customers)'), {
    columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
    rows: [
      [0, 'id', 'INTEGER', 0, null, 1],
      [1, 'email', 'TEXT', 1, null, 0],
      [2, 'full_name', 'TEXT', 0, null, 0],
      [3, 'plan', 'TEXT', 0, "'free'", 0],
      [4, 'churned', 'INTEGER', 1, '0', 0],
    ],
  });
  assert.deepEqual(rows(db, "SELECT name FROM pragma_table_info('customers') WHERE pk = 1"), [['id']]);
  db.exec('ALTER TABLE customers DROP COLUMN churned');
  assert.deepEqual(db.table('customers')!.columns, ['id', 'email', 'full_name', 'plan']);
  db.exec('DROP TABLE customers');
  assert.deepEqual(db.tableNames(), ['users_backup']);
  assert.ok(!db.dump().includes('idx_users_plan'));
  assert.throws(() => db.exec('DROP TABLE customers'), /no such table: customers/);
  db.exec('DROP TABLE IF EXISTS customers; CREATE TABLE IF NOT EXISTS users_backup (x)');
  assert.throws(() => db.exec('CREATE TABLE users_backup (x)'), /table users_backup already exists/);
  db.exec('CREATE UNIQUE INDEX ub_email ON users_backup (email)');
  assert.throws(() => db.exec("INSERT INTO users_backup (email) VALUES ('ops@example.com')"), /UNIQUE constraint failed: users_backup\.email/);
  assert.match(db.dump(), /COMMIT;\n$/);
  assert.match(db.dump(), /\nCREATE UNIQUE INDEX ub_email ON users_backup \(email\);\nCOMMIT;\n$/);
});

test('transactions: BEGIN … ROLLBACK, COMMIT, savepoints', () => {
  const db = Database.load(DUMP);
  db.exec("BEGIN; DELETE FROM users; INSERT INTO users (email) VALUES ('x@y.z'); ROLLBACK;");
  assert.equal(db.dump(), DUMP);
  db.exec("BEGIN TRANSACTION; UPDATE users SET plan = 'pro'; COMMIT;");
  assert.deepEqual(rows(db, 'SELECT DISTINCT plan FROM users'), [['pro']]);
  db.exec('BEGIN; DROP TABLE users;');
  assert.ok(db.inTransaction);
  db.rollbackOpen();
  assert.deepEqual(db.tableNames(), ['users']);
  assert.throws(() => db.exec('COMMIT'), (e: unknown) => e instanceof SqlError && e.kind === 'runtime' && e.message === 'cannot commit - no transaction is active');
  assert.throws(() => db.exec('BEGIN; BEGIN'), /cannot start a transaction within a transaction/);
  db.exec('ROLLBACK');
  db.exec("SAVEPOINT a; DELETE FROM users WHERE id = 1; SAVEPOINT b; DELETE FROM users; ROLLBACK TO b; RELEASE a;");
  assert.deepEqual(rows(db, 'SELECT id FROM users'), [[2]]);
  assert.ok(!db.inTransaction);
});

// ---- the sqlite3 command --------------------------------------------------------------------

test('sqlite3: reads and writes the database file', () => {
  const { run, file } = setup();
  expect(run('sqlite3 prod.db "SELECT * FROM users;"'), '1|dana@billosarus.io|Dana Whitfield|enterprise\n2|ops@example.com||free\n');
  expect(run(`sqlite3 ${DB} "UPDATE users SET plan = 'pro' WHERE id = 2"`), '');
  assert.equal(file(), DUMP.replace("'ops@example.com',NULL,'free'", "'ops@example.com',NULL,'pro'"));
  expect(run(`sqlite3 prod.db "UPDATE users SET plan = 'free'"`), '');
  expect(run('sqlite3 prod.db "SELECT plan FROM users"'), 'free\nfree\n');
  expect(run('sqlite3 prod.db "DELETE FROM users"'), '');
  expect(run('sqlite3 prod.db "SELECT count(*) FROM users" "SELECT 1; SELECT 2"'), '0\n1\n2\n');
  assert.ok(!file().includes('INSERT'));
});

test('sqlite3: read-only queries leave the file alone; new files appear only when written', () => {
  const script = "CREATE TABLE t(a);\nINSERT INTO t VALUES (1);\n";
  const { sh, run, file, tick } = setup(script);
  const mtime = sh.fs.stat(DB)!.mtime;
  tick();
  expect(run('sqlite3 prod.db "SELECT a FROM t" .schema .tables "BEGIN; DELETE FROM t; ROLLBACK;"'), '1\nCREATE TABLE t(a);\nt\n');
  assert.equal(file(), script);
  assert.equal(sh.fs.stat(DB)!.mtime, mtime);
  expect(run('sqlite3 new.db "SELECT 1"'), '1\n');
  assert.equal(sh.fs.stat('/srv/billosaurus/db/new.db'), null);
  expect(run('sqlite3 new.db "CREATE TABLE x (y)"'), '');
  assert.equal(sh.fs.readFile('/srv/billosaurus/db/new.db'), 'PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE x (y);\nCOMMIT;\n');
});

test('sqlite3: an unclosed BEGIN is rolled back when the command ends', () => {
  const { run, file } = setup();
  expect(run('sqlite3 prod.db "BEGIN; DELETE FROM users;" "SELECT count(*) FROM users"'), '0\n');
  assert.equal(file(), DUMP);
  expect(run('sqlite3 prod.db "BEGIN; DELETE FROM users; COMMIT;"'), '');
  assert.ok(!file().includes('INSERT'));
});

test('sqlite3: statements before an error stay applied, later ones do not run', () => {
  const { run, file } = setup();
  expect(
    run(`sqlite3 prod.db "UPDATE users SET plan = 'pro' WHERE id = 1; INSERT INTO users (email) VALUES ('ops@example.com'); DELETE FROM users;" "SELECT 1"`),
    '',
    'Runtime error: UNIQUE constraint failed: users.email (19)\n',
  );
  assert.ok(file().includes("'Dana Whitfield','pro'"));
  assert.ok(file().includes('ops@example.com'));
});

test('sqlite3: output modes', () => {
  const { run } = setup();
  const q = '"SELECT id, name, plan FROM users"';
  expect(run(`sqlite3 -header prod.db ${q}`), 'id|name|plan\n1|Dana Whitfield|enterprise\n2||free\n');
  expect(run(`sqlite3 -separator ';' -nullvalue NULL prod.db ${q}`), '1;Dana Whitfield;enterprise\n2;NULL;free\n');
  expect(run(`sqlite3 -column prod.db ${q}`), 'id  name            plan      \n--  --------------  ----------\n1   Dana Whitfield  enterprise\n2                   free      \n');
  expect(run(`sqlite3 -csv -header prod.db ${q}`), 'id,name,plan\n1,"Dana Whitfield",enterprise\n2,,free\n');
  expect(run(`sqlite3 -json prod.db ${q}`), '[{"id":1,"name":"Dana Whitfield","plan":"enterprise"},\n{"id":2,"name":null,"plan":"free"}]\n');
  expect(run(`sqlite3 -line prod.db ${q}`), '   id = 1\n name = Dana Whitfield\n plan = enterprise\n\n   id = 2\n name = \n plan = free\n');
  expect(run('sqlite3 -box prod.db "SELECT id, plan FROM users"'), '┌────┬────────────┐\n│ id │ plan       │\n├────┼────────────┤\n│ 1  │ enterprise │\n│ 2  │ free       │\n└────┴────────────┘\n');
  expect(run('sqlite3 -table prod.db "SELECT id FROM users"'), '+----+\n| id |\n+----+\n| 1  |\n| 2  |\n+----+\n');
  expect(run('sqlite3 -markdown prod.db "SELECT id FROM users"'), '| id |\n|----|\n| 1  |\n| 2  |\n');
  expect(run('sqlite3 prod.db ".mode csv" ".headers on" "SELECT id FROM users"'), 'id\r\n1\r\n2\r\n');
  expect(run('sqlite3 -json prod.db "SELECT * FROM users WHERE 0"'), '');
});

test('sqlite3: .tables, .schema, .dump, .help', () => {
  const { run } = setup();
  run('sqlite3 prod.db "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER); CREATE INDEX idx_orders_user ON orders(user_id)"');
  expect(run('sqlite3 prod.db .tables'), 'orders  users \n');
  expect(
    run('sqlite3 prod.db .schema'),
    "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, plan TEXT DEFAULT 'free');\n" +
      'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER);\nCREATE INDEX idx_orders_user ON orders(user_id);\n',
  );
  expect(run('sqlite3 prod.db ".schema orders"'), 'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER);\nCREATE INDEX idx_orders_user ON orders(user_id);\n');
  expect(run('sqlite3 prod.db ".dump users"'), DUMP);
  assert.match(run('sqlite3 prod.db .help').stdout, /^\.databases/);
  expect(run('sqlite3 prod.db .frobnicate'), '', 'Error: unknown command or invalid arguments:  "frobnicate". Enter ".help" for help\n');
});

test('sqlite3: scripts from stdin, with dot-commands', () => {
  const { sh, run, file } = setup();
  expect(run(`echo "SELECT count(*) FROM users;" | sqlite3 prod.db`), '2\n');
  sh.fs.writeFile('/srv/billosaurus/db/fix.sql', ".headers on\n.mode column\nUPDATE users\n  SET plan = 'pro'\n  WHERE id = 2;\nSELECT id, plan\nFROM users;\n.quit\nDELETE FROM users;\n");
  expect(run('sqlite3 prod.db < fix.sql'), 'id  plan      \n--  ----------\n1   enterprise\n2   pro       \n');
  assert.ok(file().includes("NULL,'pro'"));
  sh.fs.writeFile('/srv/billosaurus/db/bad.sql', 'SELECT 1;\n\nSELECT *\nFROM userz;\nSELECT 2;\n');
  expect(run('sqlite3 prod.db < bad.sql'), '1\n', 'Parse error near line 3: no such table: userz\n  SELECT * FROM userz;\n                ^--- error here\n');
  expect(run('cat fix.sql | sqlite3 -readonly prod.db'), '', 'Runtime error near line 3: attempt to write a readonly database (8)\n');
});

test('sqlite3: error messages', () => {
  const { sh, run } = setup();
  expect(run('sqlite3 prod.db "SELEC * FROM users"'), '', 'Parse error: near "SELEC": syntax error\n  SELEC * FROM users\n  ^--- error here\n');
  expect(run('sqlite3 prod.db "SELECT * FROM userz"'), '', 'Parse error: no such table: userz\n  SELECT * FROM userz\n                ^--- error here\n');
  expect(run('sqlite3 prod.db "SELECT emial FROM users"'), '', 'Parse error: no such column: emial\n  SELECT emial FROM users\n         ^--- error here\n');
  expect(run('sqlite3 prod.db "SELECT * FROM users WHERE"'), '', 'Parse error: incomplete input\n');
  expect(run('sqlite3 prod.db "CREATE TABLE users (x)"'), '', 'Parse error: table users already exists\n  CREATE TABLE users (x)\n               ^--- error here\n');
  expect(run(`sqlite3 prod.db "INSERT INTO users (email) VALUES ('ops@example.com')"`), '', 'Runtime error: UNIQUE constraint failed: users.email (19)\n');
  expect(run('sqlite3 prod.db "INSERT INTO users (name) VALUES (1)"'), '', 'Runtime error: NOT NULL constraint failed: users.email (19)\n');
  expect(run('sqlite3 prod.db "COMMIT"'), '', 'Runtime error: cannot commit - no transaction is active\n');
  expect(run('sqlite3 -readonly prod.db "UPDATE users SET plan = 1"'), '', 'Runtime error: attempt to write a readonly database (8)\n');
  expect(run('sqlite3 -readonly prod.db "SELECT count(*) FROM users"'), '2\n');
  expect(run('sqlite3 -zap prod.db'), '', 'sqlite3: Error: unknown option: -zap\nUse -help for a list of options.\n');
  expect(run('sqlite3 nowhere/x.db "SELECT 1"'), '', 'Error: unable to open database "nowhere/x.db": unable to open database file\n');
  expect(run('sqlite3 /srv "SELECT 1"'), '', 'Error: unable to open database "/srv": unable to open database file\n');
  sh.fs.writeFile('/srv/billosaurus/db/notes.txt', 'just some notes\n');
  expect(run('sqlite3 notes.txt "SELECT 1"'), '', 'Parse error: file is not a database (26)\n');
  const long = run(`sqlite3 prod.db "SELECT id, email, name, plan FROM users WHERE plan = 'enterprise' AND emial = 1"`);
  const [msg, code, marker] = long.stderr.split('\n');
  assert.equal(msg, 'Parse error: no such column: emial');
  assert.equal(code, "  me, plan FROM users WHERE plan = 'enterprise' AND emial = 1");
  assert.match(marker, /^ +error here ---\^$/);
  assert.equal(marker.indexOf('^'), code.indexOf('emial'));
});

test('sqlite3: no SQL and no stdin prints a note instead of a prompt', () => {
  const { run, file } = setup();
  const r = run('sqlite3 prod.db');
  assert.equal(r.exitCode, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /pass the SQL as an argument/);
  assert.match(r.stderr, /sqlite3 prod\.db "SELECT \* FROM users;"/);
  assert.equal(file(), DUMP);
  expect(run('sqlite3 -version'), '3.46.1 2024-08-13 09:16:08 c9c2ab54ba1f5f46360f1b4f35d849cd3f080e6fc2b6c60e91b16c63f69aalt1 (64-bit)\n');
  assert.match(run('help').stdout, /sqlite3 +query a SQLite database/);
});
