// Link-preview images for shared reviews, drawn when a link is first previewed (card-worker.ts) and
// then kept: the latest ones in memory, every one as a PNG next to its review in DATA_DIR/reviews.
// A review never changes once shared, so a card is drawn once per design (CARD_VERSION).
// Drawing is bounded: one worker draws one card at a time, only a few may wait, and a card that
// takes too long is given up on with its worker.

import { Worker } from 'node:worker_threads';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isReviewId } from './reviews.ts';
import type { SharedReview } from './reviews.ts';
import type { CardJob, CardResult } from './card-worker.ts';

/** Bump when the card's design changes, so stored cards are drawn again. */
export const CARD_VERSION = 1;

/** Too many cards being drawn right now, or this caller has asked for too many. */
export class CardBusy extends Error {}

export interface CardOptions {
  /** Where the PNGs are kept. Without it, only in memory. */
  dir?: string;
  /** The site's host, printed on the card. */
  site: string;
  /** Cards waiting or being drawn at once; more are refused. Default 6. */
  maxPending?: number;
  /** A card not drawn within this is given up on, and the worker with it. Default 20 s. */
  timeoutMs?: number;
  /** The worker stops after this long without work, freeing its memory. Default 60 s. */
  idleMs?: number;
  /** Cards kept in memory. Default 48. */
  memoryItems?: number;
  /** A review whose card failed is not tried again for this long. Default 10 min. */
  retryMs?: number;
  log?: (line: string) => void;
}

interface Job {
  resolve: (png: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class Cards {
  private opts: Required<Omit<CardOptions, 'dir'>> & { dir?: string };
  private memory = new Map<string, Buffer>();
  private pending = new Map<string, Promise<Buffer | null>>();
  private failed = new Map<string, number>();
  private worker: Worker | null = null;
  private jobs = new Map<number, Job>();
  private n = 0;
  private idle: NodeJS.Timeout | null = null;
  /** Cards drawn (not served from a copy); tests read it. */
  drawn = 0;

  constructor(opts: CardOptions) {
    this.opts = {
      maxPending: 6,
      timeoutMs: 20_000,
      idleMs: 60_000,
      memoryItems: 48,
      retryMs: 10 * 60_000,
      log: () => {},
      ...opts,
    };
  }

  /**
   * The review's card as PNG, or null when it cannot be drawn. `mayDraw` is asked only when the card
   * has to be drawn; refusing, like too many cards waiting, throws CardBusy.
   */
  async get(review: SharedReview, mayDraw: () => boolean = () => true): Promise<Buffer | null> {
    const id = review.id;
    if (!isReviewId(id)) return null;
    const kept = this.memory.get(id);
    if (kept) {
      this.memory.delete(id);
      this.memory.set(id, kept);
      return kept;
    }
    if ((this.failed.get(id) ?? 0) > Date.now()) return null;
    const running = this.pending.get(id);
    if (running) return running;
    const file = this.opts.dir ? join(this.opts.dir, `${id}.card${CARD_VERSION}.png`) : null;
    const stored = file ? await readFile(file).catch(() => null) : null;
    if (stored) return this.keep(id, stored);
    if (this.pending.size >= this.opts.maxPending || !mayDraw()) throw new CardBusy('busy');
    const p = this.draw(review)
      .then(async (png) => {
        this.drawn++;
        if (file) await this.store(file, png);
        return this.keep(id, png);
      })
      .catch(() => {
        this.failed.set(id, Date.now() + this.opts.retryMs);
        if (this.failed.size > 1000) this.failed.delete(this.failed.keys().next().value!);
        return null;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  private keep(id: string, png: Buffer): Buffer {
    this.memory.set(id, png);
    if (this.memory.size > this.opts.memoryItems) this.memory.delete(this.memory.keys().next().value!);
    return png;
  }

  /** Best effort: without a writable disk, cards stay in memory only. */
  private async store(file: string, png: Buffer): Promise<void> {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(this.opts.dir!, { recursive: true });
      await writeFile(tmp, png, { flag: 'wx' });
      await rename(tmp, file);
    } catch {
      this.opts.log('card: could not store a drawn card');
    }
  }

  private draw(review: SharedReview): Promise<Buffer> {
    const worker = this.start();
    const n = ++this.n;
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.opts.log('card: drawing took too long; restarting the card worker');
        this.stop(new Error('timed out'));
      }, this.opts.timeoutMs);
      this.jobs.set(n, { resolve, reject, timer });
      worker.postMessage({ n, review, site: this.opts.site } satisfies CardJob);
    });
  }

  private start(): Worker {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.worker) return this.worker;
    // WebAssembly memory is outside these limits; they bound the JavaScript heap of a runaway card.
    const worker = new Worker(new URL('./card-worker.ts', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 32 },
    });
    worker.unref();
    worker.on('message', (msg: CardResult) => {
      const job = this.jobs.get(msg.n);
      if (!job) return;
      clearTimeout(job.timer);
      this.jobs.delete(msg.n);
      if ('png' in msg) job.resolve(Buffer.from(msg.png.buffer, msg.png.byteOffset, msg.png.byteLength));
      else job.reject(new Error('card failed'));
      if (!this.jobs.size) this.idleSoon();
    });
    // Details stay out of the logs: they may quote a review.
    worker.on('error', () => {
      this.opts.log('card: the card worker failed');
      if (this.worker === worker) this.stop(new Error('worker failed'));
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.stop(new Error('worker exited'));
    });
    this.worker = worker;
    return worker;
  }

  private idleSoon(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.jobs.size) this.stop(new Error('idle'));
    }, this.opts.idleMs);
    this.idle.unref();
  }

  /** Stops the worker; cards it was drawing fail. */
  private stop(reason: Error): void {
    const worker = this.worker;
    this.worker = null;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(reason);
    }
    this.jobs.clear();
    void worker?.terminate();
  }

  close(): void {
    this.stop(new Error('closed'));
  }
}
