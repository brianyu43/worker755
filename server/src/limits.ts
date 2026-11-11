// Spending limits for the hosted game. Free shifts run on the server's key, so each one has a token
// allowance, all of them together share a daily budget, and each address gets a few per day.
// Shifts on a player's own key are only rate limited.

/** What a session may spend on model calls. */
export interface Allowance {
  /** False once the shift should make no more optional model calls. */
  canSpend(): boolean;
  spend(tokens: number): void;
}

/** Thrown by the session when a free shift runs out mid-game; the message is shown to the player. */
export const ALLOWANCE_SPENT = 'Your free shift has run out. Add your own API key on the start screen to keep playing.';

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
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count += 1;
    return true;
  }
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
