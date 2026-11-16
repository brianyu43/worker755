// Players who sign in, and the shifts they may play on the server's key. One SQLite file in
// DATA_DIR. A new account gets its free shifts; packs bought through Freemius add paid ones. A shift
// is taken when it starts and given back if the manager fails before any task is done.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type Provider = 'google' | 'github';

export interface Account {
  id: string;
  email: string;
  name: string;
  /** Shifts given on sign-up, not yet played. */
  freeShifts: number;
  /** Shifts bought, not yet played. */
  paidShifts: number;
}

/** Which kind of shift was taken, so the same kind is given back. */
export type ShiftKind = 'free' | 'paid';

/** How long a checkout may claim the license of a buyer with the same email. */
const CLAIM_MS = 30 * 24 * 60 * 60_000;

interface Row {
  id: string;
  email: string;
  name: string;
  free_shifts: number;
  paid_shifts: number;
}

const toAccount = (r: Row): Account => ({
  id: r.id,
  email: r.email,
  name: r.name,
  freeShifts: r.free_shifts,
  paidShifts: r.paid_shifts,
});

export class Accounts {
  private readonly db: DatabaseSync;
  private readonly freeOnSignUp: number;
  private readonly now: () => number;

  /** file: the database, or ':memory:' (tests). */
  constructor(file: string, freeOnSignUp = 1, now: () => number = Date.now) {
    this.db = new DatabaseSync(file);
    this.freeOnSignUp = freeOnSignUp;
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        free_shifts INTEGER NOT NULL DEFAULT 0,
        paid_shifts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS accounts_email ON accounts(lower(email));
      CREATE TABLE IF NOT EXISTS identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (provider, subject)
      );
      CREATE TABLE IF NOT EXISTS checkouts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        license_id TEXT
      );
      CREATE TABLE IF NOT EXISTS purchases (
        license_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        shifts INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  get(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
    return row ? toAccount(row) : null;
  }

  /**
   * The account of someone signing in: the one this identity already has, else the one with the same
   * verified email (so Google and GitHub with one address are one account), else a new one with its
   * free shifts.
   */
  signIn(provider: Provider, subject: string, email: string, name: string): { account: Account; created: boolean } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const known = this.db
        .prepare('SELECT account_id FROM identities WHERE provider = ? AND subject = ?')
        .get(provider, subject) as { account_id: string } | undefined;
      let id = known?.account_id;
      let created = false;
      if (!id && email) {
        const same = this.db
          .prepare('SELECT id FROM accounts WHERE lower(email) = lower(?) ORDER BY created_at LIMIT 1')
          .get(email) as { id: string } | undefined;
        id = same?.id;
      }
      if (!id) {
        id = randomBytes(12).toString('base64url');
        created = true;
        this.db
          .prepare('INSERT INTO accounts (id, email, name, free_shifts, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, email, name, this.freeOnSignUp, this.now());
      }
      if (!known) this.db.prepare('INSERT INTO identities (provider, subject, account_id) VALUES (?, ?, ?)').run(provider, subject, id);
      if (name) this.db.prepare("UPDATE accounts SET name = ? WHERE id = ? AND name = ''").run(name, id);
      this.db.exec('COMMIT');
      return { account: this.get(id)!, created };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Takes one shift, a free one first; null when none is left. */
  take(id: string): ShiftKind | null {
    if (this.db.prepare('UPDATE accounts SET free_shifts = free_shifts - 1 WHERE id = ? AND free_shifts > 0').run(id).changes) {
      return 'free';
    }
    if (this.db.prepare('UPDATE accounts SET paid_shifts = paid_shifts - 1 WHERE id = ? AND paid_shifts > 0').run(id).changes) {
      return 'paid';
    }
    return null;
  }

  /** Gives back a shift taken for a shift that never got going. */
  giveBack(id: string, kind: ShiftKind): void {
    const column = kind === 'free' ? 'free_shifts' : 'paid_shifts';
    this.db.prepare(`UPDATE accounts SET ${column} = ${column} + 1 WHERE id = ?`).run(id);
  }

  /** Notes that this account is about to pay, so the license can find it by the buyer's email. */
  openCheckout(accountId: string, email: string): void {
    this.db
      .prepare('INSERT INTO checkouts (id, account_id, email, created_at) VALUES (?, ?, ?, ?)')
      .run(randomBytes(9).toString('base64url'), accountId, email, this.now());
  }

  /** The account a license belongs to: already credited, already claimed, or the latest open checkout with this email. */
  ownerOf(licenseId: string, email: string): string | null {
    const bought = this.db.prepare('SELECT account_id FROM purchases WHERE license_id = ?').get(licenseId) as { account_id: string } | undefined;
    if (bought) return bought.account_id;
    const claimed = this.db.prepare('SELECT account_id FROM checkouts WHERE license_id = ?').get(licenseId) as { account_id: string } | undefined;
    if (claimed) return claimed.account_id;
    if (!email) return null;
    const open = this.db
      .prepare(
        'SELECT id, account_id FROM checkouts WHERE lower(email) = lower(?) AND license_id IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(email, this.now() - CLAIM_MS) as { id: string; account_id: string } | undefined;
    if (!open) return null;
    this.db.prepare('UPDATE checkouts SET license_id = ? WHERE id = ?').run(licenseId, open.id);
    return open.account_id;
  }

  /** Adds a pack's shifts once per license. Returns false when this license was already credited. */
  credit(licenseId: string, accountId: string, shifts: number): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const done = this.db.prepare('SELECT 1 FROM purchases WHERE license_id = ?').get(licenseId);
      if (done) {
        this.db.exec('COMMIT');
        return false;
      }
      this.db
        .prepare("INSERT INTO purchases (license_id, account_id, shifts, status, created_at) VALUES (?, ?, ?, 'paid', ?)")
        .run(licenseId, accountId, shifts, this.now());
      this.db.prepare('UPDATE accounts SET paid_shifts = paid_shifts + ? WHERE id = ?').run(shifts, accountId);
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** A refunded pack takes back its shifts, as many as are left. Returns the account, or null when nothing changed. */
  refund(licenseId: string): string | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const p = this.db
        .prepare("SELECT account_id, shifts FROM purchases WHERE license_id = ? AND status = 'paid'")
        .get(licenseId) as { account_id: string; shifts: number } | undefined;
      if (p) {
        this.db.prepare("UPDATE purchases SET status = 'refunded' WHERE license_id = ?").run(licenseId);
        this.db.prepare('UPDATE accounts SET paid_shifts = max(0, paid_shifts - ?) WHERE id = ?').run(p.shifts, p.account_id);
      }
      this.db.exec('COMMIT');
      return p?.account_id ?? null;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
