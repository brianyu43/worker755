// Spending limits for the hosted game. Without sign-in, free shifts run on the server's key, so each
// one has a token allowance, all of them together share a daily budget, and each address gets a few
// per day. With sign-in, an account's credit is the limit (billing.ts).
// Shifts on a player's own key are only rate limited.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { en } from './i18n/en.ts';

/** One model call, for pricing it. */
export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The part of inputTokens read from the provider's prompt cache. */
  cachedInputTokens?: number;
  /** What the provider charged for the call in dollars, when it says. */
  cost?: number;
}

/** What a session may spend on model calls. */
export interface Allowance {
  /**
   * 'tokens' (default): a free shift's token cap; running out pauses for 'allowance'. 'credit': an
   * account's credit; running out has the user complain first, then pauses for 'usage'.
   */
  readonly kind?: 'tokens' | 'credit';
  /** False once the shift should make no more optional model calls. */
  canSpend(): boolean;
  /** tokens: weighted tokens (cached input counts a tenth); call: the call itself, when it is a real one. */
  spend(tokens: number, call?: CallUsage): void;
}

/** Thrown by the session when a free shift runs out mid-game; the message is shown to the player. */
export const ALLOWANCE_SPENT = en.errors.allowanceSpent;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Tokens spent across all free shifts today (UTC). */
export class DailyBudget {
  readonly limit: number;
  private now: () => number;
  private day = '';
  private spent = 0;
  constructor(limit: number, now: () => number = Date.now) {
    this.limit = limit;
    this.now = now;
  }

  private roll(): void {
    const d = utcDay(this.now());
    if (d !== this.day) {
      this.day = d;
      this.spent = 0;
    }
  }

  get used(): number {
    this.roll();
    return this.spent;
  }

  exhausted(): boolean {
    return this.used >= this.limit;
  }

  spend(tokens: number): void {
    this.roll();
    this.spent += tokens;
    this.onChange?.();
  }

  /** Called after every change, so the count can be saved. */
  onChange?: () => void;

  save(): { day: string; spent: number } {
    this.roll();
    return { day: this.day, spent: this.spent };
  }

  restore(v: unknown): void {
    const o = v as { day?: unknown; spent?: unknown } | null;
    if (!o || typeof o.day !== 'string' || typeof o.spent !== 'number' || !Number.isFinite(o.spent)) return;
    this.roll();
    if (o.day === this.day) this.spent = Math.max(this.spent, o.spent);
  }
}

/** Counts events per key in a fixed window; old windows are dropped as they expire. */
export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private now: () => number;
  private hits = new Map<string, { start: number; count: number }>();
  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records a hit and says whether it is within the limit. */
  take(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
    }
    const cur = this.hits.get(key);
    if (!cur || t - cur.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      this.onChange?.();
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count += 1;
    this.onChange?.();
    return true;
  }

  /** Called after every change, so the counts can be saved. */
  onChange?: () => void;

  save(): [string, number, number][] {
    const t = this.now();
    return [...this.hits].filter(([, v]) => t - v.start < this.windowMs).map(([k, v]) => [k, v.start, v.count]);
  }

  restore(v: unknown): void {
    if (!Array.isArray(v)) return;
    for (const e of v.slice(0, 50_000)) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || typeof e[2] !== 'number') continue;
      this.hits.set(e[0], { start: e[1], count: e[2] });
    }
  }
}

/**
 * An amount per key in a fixed window: bytes a browser may send to keep the server's copy of its files
 * up to date, so one address cannot keep the server parsing all day.
 */
export class WindowBudget {
  readonly limit: number;
  readonly windowMs: number;
  private now: () => number;
  private used = new Map<string, { start: number; amount: number }>();
  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  private entry(key: string): { start: number; amount: number } {
    const t = this.now();
    if (this.used.size > 10_000) {
      for (const [k, v] of this.used) if (t - v.start >= this.windowMs) this.used.delete(k);
    }
    let cur = this.used.get(key);
    if (!cur || t - cur.start >= this.windowMs) {
      cur = { start: t, amount: 0 };
      this.used.set(key, cur);
    }
    return cur;
  }

  /** Whether the key has some left in this window. */
  allows(key: string): boolean {
    return this.entry(key).amount < this.limit;
  }

  charge(key: string, amount: number): void {
    this.entry(key).amount += amount;
  }
}

/**
 * Keeps limits in a JSON file, so a restart does not hand out a fresh daily budget. Loads at once;
 * saves a couple of seconds after a change, and on flush().
 */
export function persisted(file: string, parts: Record<string, { save(): unknown; restore(v: unknown): void; onChange?: () => void }>, log: (line: string) => void) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (const [name, part] of Object.entries(parts)) if (data && name in data) part.restore(data[name]);
  } catch {
    // No saved limits yet, or an unreadable file: start from zero.
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      const out = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, part.save()]));
      writeFileSync(`${file}.tmp`, JSON.stringify(out));
      renameSync(`${file}.tmp`, file);
    } catch {
      log('saving limits failed');
    }
  };
  const changed = () => {
    if (timer) return;
    timer = setTimeout(flush, 2000);
    timer.unref();
  };
  for (const part of Object.values(parts)) part.onChange = changed;
  return { flush };
}

/** A free shift's allowance: its own cap, and the shared daily budget. */
export function freeAllowance(sessionTokens: number, daily: DailyBudget): Allowance {
  let spent = 0;
  return {
    canSpend: () => spent < sessionTokens && !daily.exhausted(),
    spend(tokens) {
      spent += tokens;
      daily.spend(tokens);
    },
  };
}
