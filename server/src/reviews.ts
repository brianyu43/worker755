// Shared performance reviews: a finished shift can be saved under a short id and opened by anyone
// at /r/<id>. Snapshots are built on the server from the session, so a shared review cannot be
// edited by whoever shares it. One JSON file per review in DATA_DIR/reviews.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Stats } from './types.ts';

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
}

const ID_RE = /^[A-Za-z0-9]{10}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function isReviewId(v: string): boolean {
  return ID_RE.test(v);
}

function newId(): string {
  const bytes = randomBytes(10);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

export class ReviewStore {
  /** Stops accepting new reviews past this many, so a busy or abused server cannot fill its disk. */
  readonly maxReviews: number;
  private dir: string;
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
