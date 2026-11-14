// Shared performance reviews: a finished shift can be saved under a short id and opened by anyone
// at /r/<id>. Snapshots are built on the server from the session, so a shared review cannot be
// edited by whoever shares it. One JSON file per review in DATA_DIR/reviews.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Language } from './language.ts';
import type { Stats } from './types.ts';

/** The worker's avatar as the player picked it: a shape id from the web app's set and a colour. */
export interface Face {
  id: string;
  color: string;
}

export function isFace(v: unknown): v is Face {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return typeof f.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(f.id) && typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color);
}

export interface SharedReview {
  id: string;
  createdAt: number;
  review: string;
  stats: Stats;
  model: string;
  director: string;
  subagent: string;
  scenario: string;
  /** Paths of the user's things the shift destroyed. */
  lost: string[];
  /** The language the shift was played in; the shared page opens in it. Missing on older reviews. */
  language?: Language;
  /** The sharer's avatar, when their browser sent one. */
  face?: Face;
  /** The player rewrote how the user treats the manager, so the review is partly theirs. */
  customStance?: boolean;
}

const ID_RE = /^[A-Za-z0-9]{10}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function isReviewId(v: string): boolean {
  return ID_RE.test(v);
}

function newId(): string {
  // Bytes past the last whole multiple of the alphabet are skipped, so every letter is equally likely.
  const cut = 256 - (256 % ALPHABET.length);
  let id = '';
  while (id.length < 10) {
    for (const b of randomBytes(16)) if (b < cut && id.length < 10) id += ALPHABET[b % ALPHABET.length];
  }
  return id;
}

export class ReviewStore {
  /** Stops accepting new reviews past this many, so a busy or abused server cannot fill its disk. */
  readonly maxReviews: number;
  /** DATA_DIR/reviews; the reviews' link-preview images are kept here too (cards.ts). */
  readonly dir: string;
  private count: number | null = null;

  constructor(dataDir: string, maxReviews = 100_000) {
    this.dir = join(dataDir, 'reviews');
    this.maxReviews = maxReviews;
  }

  private async size(): Promise<number> {
    if (this.count === null) {
      await mkdir(this.dir, { recursive: true });
      this.count = (await readdir(this.dir)).filter((f) => f.endsWith('.json')).length;
    }
    return this.count;
  }

  /** Saves a review and returns it with its id, or null when the store is full. */
  async save(review: Omit<SharedReview, 'id' | 'createdAt'>): Promise<SharedReview | null> {
    if ((await this.size()) >= this.maxReviews) return null;
    const full: SharedReview = { id: newId(), createdAt: Date.now(), ...review };
    await writeFile(join(this.dir, `${full.id}.json`), JSON.stringify(full), { flag: 'wx' });
    this.count = (this.count ?? 0) + 1;
    return full;
  }

  async get(id: string): Promise<SharedReview | null> {
    if (!isReviewId(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as SharedReview;
    } catch {
      return null;
    }
  }
}
