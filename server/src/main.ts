import { fileURLToPath } from 'node:url';
import { createApp } from './http.ts';
import { ReviewStore } from './reviews.ts';

// Empty means unset: some launchers pass unset variables through as empty strings.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const mock = process.env.MOCK_LLM === '1';
const port = envNumber('PORT', 8755);
const timeoutMs = envNumber('INSTRUCTION_TIMEOUT_MS', 90_000);
const host = process.env.HOST || '127.0.0.1';
const staticDir = process.env.STATIC_DIR || fileURLToPath(new URL('../../web/dist', import.meta.url));
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));

// Never let a stray rejection print an error object that may describe a keyed request.
process.on('unhandledRejection', () => console.error('unhandled rejection (details suppressed)'));
process.on('uncaughtException', () => {
  console.error('uncaught exception (details suppressed)');
  process.exit(1);
});

// With AI_GATEWAY_API_KEY set, players get free shifts on it, within these limits.
// Without it, every player brings their own key.
const hosted = !mock && !!process.env.AI_GATEWAY_API_KEY;
const free = hosted
  ? {
      sessionTokens: envNumber('FREE_SHIFT_TOKENS', 250_000),
      dailyTokens: envNumber('FREE_DAILY_TOKENS', 5_000_000),
      perAddressPerDay: envNumber('FREE_SHIFTS_PER_DAY', 3),
    }
  : undefined;

const app = createApp({
  mock,
  timeoutMs,
  staticDir,
  mockDelayMs: envNumber('MOCK_DELAY_MS', 700),
  free,
  shiftsPerHour: envNumber('SHIFTS_PER_HOUR', 30),
  trustProxy: process.env.TRUST_PROXY === '1',
  reviews: process.env.SHARING === '0' ? undefined : new ReviewStore(dataDir),
  donateUrl: process.env.DONATE_URL || undefined,
  sourceUrl: process.env.SOURCE_URL || undefined,
});

const mode = mock ? 'scripted manager' : hosted ? 'free shifts and own keys' : 'own keys only';
app.server.listen(port, host, () => {
  console.log(`worker-755 server on http://${host}:${port} (${mode}, ${timeoutMs / 1000}s per instruction)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
