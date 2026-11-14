// Visit and shift counts per UTC day, to learn where players come from and how far they get. No
// cookies and no addresses are kept: a visitor is a hash of address and browser under a salt that
// lives only in memory for the day, so the count restarts with the server. One JSON file per day in
// DATA_DIR/stats; read them with `node server/scripts/stats.ts`.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DayStats {
  /** Visitors seen since the server started this day; a lower bound after a restart. */
  visitors: number;
  counts: Record<string, number>;
}

export interface Visit {
  /** The page's path, e.g. / or /r/abc. */
  path?: unknown;
  /** document.referrer. */
  ref?: unknown;
  /** utm_source or ref from the page's query. */
  source?: unknown;
  lang?: unknown;
  mobile?: unknown;
}

/** Distinct values kept per dimension per day; the rest count as "other". */
const MAX_VALUES = 300;
const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Keeps the readable part of a value: short, lowercase, letters, digits and a few separators. */
function label(v: unknown, max = 40): string {
  if (typeof v !== 'string') return '';
  return v.toLowerCase().replace(/[^a-z0-9._\-/]/g, '').slice(0, max);
}

/** news.ycombinator.com, reddit.com, t.me…; nothing for direct visits and our own pages. */
export function referrerHost(ref: unknown, ownHost = ''): string {
  if (typeof ref !== 'string' || !ref) return '';
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^(www|m|old|l|lm)\./, '');
    return host === ownHost.replace(/^www\./, '') ? '' : label(host, 60);
  } catch {
    return '';
  }
}

export class Stats {
  private today = day();
  private data: DayStats = { visitors: 0, counts: {} };
  private seen = new Set<string>();
  private salt = randomBytes(16);
  private dirty = false;
  private readonly timer: ReturnType<typeof setInterval> | null;
  private readonly dir: string | null;
  private readonly ownHost: string;
  private readonly log: (line: string) => void;

  constructor(dir: string | null, ownHost = '', log: (line: string) => void = () => {}) {
    this.dir = dir;
    this.ownHost = ownHost;
    this.log = log;
    if (dir) {
      try {
        mkdirSync(dir, { recursive: true });
        this.data = JSON.parse(readFileSync(this.file(this.today), 'utf8')) as DayStats;
      } catch {
        /* a new day, or no file yet */
      }
      this.timer = setInterval(() => this.flush(), 60_000);
      this.timer.unref();
    } else {
      this.timer = null;
    }
  }

  private file(d: string) {
    return join(this.dir!, `${d}.json`);
  }

  private roll(): void {
    const d = day();
    if (d === this.today) return;
    this.flush();
    this.today = d;
    this.data = { visitors: 0, counts: {} };
    this.seen.clear();
    this.salt = randomBytes(16);
  }

  /** Adds n to a counter, e.g. shift:start or shift:persona:toxic. */
  count(name: string, n = 1): void {
    this.roll();
    const c = this.data.counts;
    const [kind] = name.split(':', 1);
    if (!(name in c) && Object.keys(c).filter((k) => k.startsWith(kind)).length >= MAX_VALUES) name = `${kind}:other`;
    c[name] = (c[name] ?? 0) + n;
    this.dirty = true;
  }

  /** A page load in a browser. who is the address and user agent; only its salted hash is held, for today. */
  visit(v: Visit, who: string): void {
    this.roll();
    const id = createHash('sha256').update(this.salt).update(who).digest('base64').slice(0, 16);
    const fresh = !this.seen.has(id);
    if (fresh) {
      this.seen.add(id);
      this.data.visitors++;
    }
    const path = label(v.path);
    this.count(`view:${path.startsWith('/r/') ? '/r' : path || '/'}`);
    if (!fresh) return;
    this.count(`ref:${referrerHost(v.ref, this.ownHost) || 'direct'}`);
    const source = label(v.source);
    if (source) this.count(`source:${source}`);
    const lang = label(v.lang, 8);
    if (lang) this.count(`lang:${lang}`);
    this.count(v.mobile === true ? 'device:mobile' : 'device:desktop');
  }

  snapshot(): DayStats {
    this.roll();
    return structuredClone(this.data);
  }

  flush(): void {
    if (!this.dir || !this.dirty) return;
    try {
      writeFileSync(this.file(this.today), JSON.stringify(this.data));
      this.dirty = false;
    } catch {
      this.log('stats not saved');
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }
}
