// The worker thread that draws link-preview cards (card-render.ts), one at a time, off the thread
// every game runs on. cards.ts starts it on the first card and stops it when it has been idle.

import { parentPort } from 'node:worker_threads';
import { renderReviewCard } from './card-render.ts';
import type { SharedReview } from './reviews.ts';

export interface CardJob {
  n: number;
  review: SharedReview;
  site: string;
}

export type CardResult = { n: number; png: Uint8Array } | { n: number; failed: true };

let queue = Promise.resolve();

parentPort?.on('message', (job: CardJob) => {
  queue = queue.then(async () => {
    try {
      const png = await renderReviewCard(job.review, job.site);
      parentPort!.postMessage({ n: job.n, png } satisfies CardResult, [png.buffer as ArrayBuffer]);
    } catch {
      // A review the renderer cannot draw; what it was stays out of the logs.
      parentPort!.postMessage({ n: job.n, failed: true } satisfies CardResult);
    }
  });
});
