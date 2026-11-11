import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Session } from './session.ts';
import { VfsError } from './shell.ts';
import { cleanSubagentName, createLiveDriver, createMockDriver, SUBAGENT_NAMES } from './manager.ts';
import { createLiveDirector, DIRECTOR_SETTING, scriptedDirector } from './director.ts';
import type { DirectorDriver } from './director.ts';
import type { ManagerDriver } from './manager.ts';
import { freeModels, listModels, MOCK_MODEL } from './models.ts';
import { isScenarioId, SCENARIO_LIST } from './scenarios.ts';
import type { ModelOption } from './models.ts';
import { hostedCredentials, isPlausibleKey, isProviderId, PROVIDERS } from './providers.ts';
import type { Credentials, ProviderId } from './providers.ts';
import { DailyBudget, freeAllowance, RateLimiter } from './limits.ts';
import type { Allowance } from './limits.ts';
import { isReviewId, ReviewStore } from './reviews.ts';
import type { SharedReview } from './reviews.ts';
import { isLanguage } from './language.ts';
import { copyFor } from './i18n/index.ts';

export interface AppOptions {
  mock: boolean;
  timeoutMs: number;
  /** Directory with the built web app; served when it exists. */
  staticDir?: string;
  /** Delay per scripted manager step, so the offline game is watchable. */
  mockDelayMs?: number;
  /** Overrides model discovery and driver creation (tests). */
  models?: (provider: ProviderId) => Promise<ModelOption[]>;
  driverFor?: (model: string, cred: Credentials | null) => ManagerDriver;
  /** Commands per player per 5 s (tests raise it). */
  commandsPerWindow?: number;
  /** Overrides the director model (tests). */
  directorFor?: (model: string, scenario: string, cred: Credentials | null) => DirectorDriver;
  /**
   * Free shifts on the server's key. Without it, players must bring their own key (unless mock).
   * `credentials` defaults to AI_GATEWAY_API_KEY.
   */
  free?: { sessionTokens: number; dailyTokens: number; perAddressPerDay: number; credentials?: Credentials };
  /** New shifts per address per hour, on any key. Default 30. */
  shiftsPerHour?: number;
  /** Read the client address from cf-connecting-ip / x-forwarded-for (behind a trusted proxy). */
  trustProxy?: boolean;
  /** Where shared reviews are kept. Without it, sharing is off. */
  reviews?: ReviewStore;
  /** Shown to players as a way to support the game. */
  donateUrl?: string;
  /** Link to the game's source code. */
  sourceUrl?: string;
  idleMs?: number;
  log?: (line: string) => void;
}

export interface App {
  server: Server;
  sessions: Map<string, Session>;
  close(): Promise<void>;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

/** Sent with every response. The app has no inline scripts; React sets inline styles. */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** An address as the limits count it: IPv4 as is, IPv6 by its /64 prefix. */
export function addressKey(address: string): string {
  const a = address.replace(/^::ffff:/, '');
  if (!a.includes(':')) return a;
  // Expand :: so the first four groups are the /64.
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON');
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

function vfsMessage(err: unknown): string {
  if (err instanceof VfsError) return err.message;
  return 'File operation failed';
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(root: string, pathname: string, res: ServerResponse): Promise<boolean> {
  if (!existsSync(root)) return false;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const base = resolve(root);
  let file = normalize(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    // Directory index, or SPA fallback for extension-less routes.
    if (existsSync(index)) file = index;
    else if (!extname(rel)) file = join(base, 'index.html');
    else return false;
    if (!existsSync(file)) return false;
  }
  const body = await readFile(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(body);
  return true;
}

/** What a finished shift looks like to people it is shared with; null while it is still running. */
export function snapshot(s: Session): Omit<SharedReview, 'id' | 'createdAt'> | null {
  const st = s.state();
  const over = st.events.find((e) => e.type === 'game_over');
  if (st.status !== 'finished' || !over || over.type !== 'game_over') return null;
  const lost = [...new Set(st.events.flatMap((e) => (e.type === 'outrage' ? e.items : [])))];
  return {
    review: over.review,
    stats: over.stats,
    model: st.model,
    director: st.director ?? '',
    subagent: st.subagent,
    scenario: st.scenario,
    lost,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Replaces the page's title and description tags with ones for this review. */
export function withPreview(html: string, review: SharedReview): string {
  const first = review.review.replace(/\s+/g, ' ').trim();
  const desc = first.length > 200 ? first.slice(0, 197).trimEnd() + '...' : first;
  const title = 'Worker 755: performance review';
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join('\n    ');
  return html
    .replace(/<meta (name="description"|property="og:[a-z]+"|name="twitter:[a-z]+") content="[^"]*" \/>\s*/g, '')
    .replace(/<title>[^<]*<\/title>/, tags);
}

export function createApp(opts: AppOptions): App {
  const sessions = new Map<string, Session>();
  const log = opts.log ?? ((line: string) => console.log(line));
  const models = opts.models ?? (opts.mock ? async () => [MOCK_MODEL] : listModels);
  const driverFor =
    opts.driverFor ??
    ((model: string, cred: Credentials | null) =>
      opts.mock || !cred ? createMockDriver(opts.mockDelayMs ?? 0) : createLiveDriver(model, cred));
  const directorFor =
    opts.directorFor ??
    ((model: string, scenario: string, cred: Credentials | null) =>
      opts.mock || !cred ? scriptedDirector(model) : createLiveDirector(model, DIRECTOR_SETTING[scenario], cred));
  const idleMs = opts.idleMs ?? 60 * 60_000;
  const freeCred = opts.free ? (opts.free.credentials ?? hostedCredentials()) : null;
  const daily = opts.free ? new DailyBudget(opts.free.dailyTokens) : null;
  const freePerAddress = opts.free ? new RateLimiter(opts.free.perAddressPerDay, 24 * 60 * 60_000) : null;
  const shiftLimiter = new RateLimiter(opts.shiftsPerHour ?? 30, 60 * 60_000);
  /** Session id -> shared review id, so sharing twice gives the same link. */
  const shared = new Map<string, string>();

  /** Free shifts are offered: scripted mode, or the server has a key and budget left today. */
  const freeOpen = () => opts.mock || (!!freeCred && !!daily && !daily.exhausted());
  const freeList = async () => (opts.mock ? models('gateway') : freeModels(await models('gateway')));

  /**
   * Who is asking, for the limits. Behind Cloudflare every request reaches us from the local tunnel,
   * so with TRUST_PROXY the address is Cloudflare's CF-Connecting-IP, which clients cannot set past its
   * edge. X-Forwarded-For is not trusted: anyone can write it. IPv6 counts per /64, since one
   * household gets a whole /64 to rotate through.
   */
  function clientAddress(req: IncomingMessage): string {
    const cf = req.headers['cf-connecting-ip'];
    const raw = opts.trustProxy && typeof cf === 'string' && cf.trim() ? cf.trim() : (req.socket.remoteAddress ?? 'unknown');
    return addressKey(raw);
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.listenerCount === 0 && now - s.lastActivity > idleMs) {
        s.dispose();
        sessions.delete(id);
      }
    }
  }, Math.min(60_000, idleMs));
  sweeper.unref();

  function getSession(id: string): Session {
    const s = sessions.get(id);
    if (!s) throw new HttpError(404, 'Session not found');
    s.touch();
    return s;
  }

  function events(req: IncomingMessage, res: ServerResponse, s: Session, url: URL): void {
    const fromQuery = Number(url.searchParams.get('after') ?? '');
    const fromHeader = Number(req.headers['last-event-id'] ?? '');
    const after = Number.isFinite(fromQuery) && url.searchParams.has('after')
      ? fromQuery
      : Number.isFinite(fromHeader) ? fromHeader : 0;
    if (url.searchParams.get('poll') === '1') return poll(res, s, after);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const write = (e: { seq: number }) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    for (const e of s.eventsAfter(after)) write(e);
    const unsubscribe = s.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    const done = () => {
      clearInterval(ping);
      unsubscribe();
      s.touch();
    };
    req.on('close', done);
    // The game clock starts once someone is watching.
    s.start();
  }

  // Long-poll fallback for proxies that buffer event streams (e.g. Cloudflare quick tunnels):
  // answers at once with any events after `after`, otherwise waits up to 25s for the next one.
  function poll(res: ServerResponse, s: Session, after: number): void {
    s.start();
    const reply = () => {
      clearTimeout(timer);
      unsubscribe();
      res.off('close', abort);
      if (!res.writableEnded) sendJson(res, 200, { events: s.eventsAfter(after) });
      s.touch();
    };
    const abort = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    // Defer so events emitted in the same tick land in one response.
    const unsubscribe = s.subscribe(() => setImmediate(reply));
    const timer = setTimeout(reply, 25_000);
    res.on('close', abort);
    if (s.eventsAfter(after).length > 0) reply();
  }

  /** The page for a shared review: the app's index.html with the review in its link-preview tags. */
  async function serveReviewPage(id: string, res: ServerResponse): Promise<boolean> {
    const index = join(resolve(opts.staticDir!), 'index.html');
    if (!existsSync(index)) return false;
    let html = await readFile(index, 'utf8');
    const review = opts.reviews && isReviewId(id) ? await opts.reviews.get(id) : null;
    if (review) html = withPreview(html, review);
    res.writeHead(review ? 200 : 404, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    res.end(html);
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (!path.startsWith('/api/')) {
      const rp = /^\/r\/([^/]+)\/?$/.exec(path);
      if (rp && (method === 'GET' || method === 'HEAD') && opts.staticDir && (await serveReviewPage(rp[1], res))) return;
      if ((method === 'GET' || method === 'HEAD') && opts.staticDir && (await serveStatic(opts.staticDir, path, res))) return;
      throw new HttpError(404, 'Not found');
    }

    if (path === '/api/models' && method === 'GET') {
      // Without ?provider: the free-shift models. With it: what a player's own key can use there.
      const p = url.searchParams.get('provider');
      if (p !== null && !isProviderId(p)) throw new HttpError(400, 'Unknown provider');
      const list = p ? await models(p) : freeOpen() ? await freeList() : [];
      sendJson(res, 200, {
        models: list,
        default: list[0]?.id ?? '',
        mock: opts.mock,
        free: freeOpen(),
        providers: PROVIDERS,
        subagents: SUBAGENT_NAMES,
        scenarios: SCENARIO_LIST,
        donateUrl: opts.donateUrl ?? '',
        sourceUrl: opts.sourceUrl ?? '',
        sharing: !!opts.reviews,
      });
      return;
    }

    const r = /^\/api\/reviews\/([^/]+)$/.exec(path);
    if (r && method === 'GET') {
      const review = opts.reviews && isReviewId(r[1]) ? await opts.reviews.get(r[1]) : null;
      if (!review) throw new HttpError(404, 'Review not found');
      return sendJson(res, 200, review);
    }

    if (path === '/api/sessions' && method === 'POST') {
      const body = await readJson(req);
      // Refusals a player can act on are in the player's language; malformed requests are not.
      const errors = copyFor(isLanguage(body.language) ? body.language : 'en').errors;
      // A player's own key, or a free shift on the server's key.
      let cred: Credentials | null = null;
      let list: ModelOption[];
      const own = body.apiKey !== undefined && body.apiKey !== '';
      if (own) {
        if (!isProviderId(body.provider)) throw new HttpError(400, 'Unknown provider');
        if (!isPlausibleKey(body.apiKey)) throw new HttpError(400, errors.notAKey);
        cred = { provider: body.provider, apiKey: body.apiKey };
        list = await models(body.provider);
      } else {
        if (!opts.mock && !freeCred) throw new HttpError(400, errors.keyNeeded);
        if (!freeOpen()) throw new HttpError(429, errors.freeClosed);
        cred = freeCred;
        list = await freeList();
      }
      const requested = typeof body.model === 'string' && body.model ? body.model : list[0]?.id;
      if (!requested) throw new HttpError(503, 'No manager model is available');
      if (!list.some((m) => m.id === requested)) throw new HttpError(400, `Unknown model: ${requested}`);
      const allowSkip = body.allowSkip === true;
      const subagent = cleanSubagentName(body.subagent);
      if (body.scenario !== undefined && !isScenarioId(body.scenario)) throw new HttpError(400, 'Unknown workplace');
      const scenario = isScenarioId(body.scenario) ? body.scenario : 'fresh';
      if (body.language !== undefined && !isLanguage(body.language)) throw new HttpError(400, 'Unsupported language');
      const language = isLanguage(body.language) ? body.language : 'en';
      // '' or 'scripted' keeps the scripted lines; any offered model writes the user's messages instead.
      const directorId = typeof body.director === 'string' && body.director !== 'scripted' ? body.director : '';
      if (directorId && !list.some((m) => m.id === directorId)) throw new HttpError(400, `Unknown model: ${directorId}`);
      // Limits are counted only for requests that would start a shift.
      const address = clientAddress(req);
      if (!shiftLimiter.take(address)) throw new HttpError(429, errors.tooManyShifts);
      let allowance: Allowance | undefined;
      if (!own && !opts.mock && opts.free && daily) {
        if (!freePerAddress!.take(address)) {
          throw new HttpError(429, errors.freeUsed);
        }
        allowance = freeAllowance(opts.free.sessionTokens, daily);
      }
      const director = directorId ? directorFor(directorId, scenario, cred) : undefined;
      const session = new Session({
        commandsPerWindow: opts.commandsPerWindow,
        driver: driverFor(requested, cred),
        allowance,
        timeoutMs: opts.timeoutMs,
        allowSkip,
        subagent,
        scenario,
        director,
        language,
        log,
      });
      sessions.set(session.id, session);
      // Fallback in case the page never opens the event stream.
      setTimeout(() => session.start(), 10_000).unref();
      sendJson(res, 201, session.state());
      return;
    }

    const m = /^\/api\/sessions\/([^/]+)(?:\/(events|exec|file|report|share))?$/.exec(path);
    if (!m) throw new HttpError(404, 'Not found');
    const s = getSession(m[1]);
    const sub = m[2];

    if (!sub && method === 'GET') return sendJson(res, 200, s.state());
    if (sub === 'events' && method === 'GET') return events(req, res, s, url);
    if ((sub === 'exec' && method === 'POST') || (sub === 'file' && method === 'PUT')) {
      if (!s.allowCommand()) throw new HttpError(429, s.copy.errors.slowDown);
    }
    if (sub === 'exec' && method === 'POST') {
      const body = await readJson(req);
      if (typeof body.line !== 'string') throw new HttpError(400, 'line must be a string');
      return sendJson(res, 200, s.exec(body.line));
    }
    if (sub === 'file' && method === 'GET') {
      const p = url.searchParams.get('path');
      if (!p) throw new HttpError(400, 'path is required');
      try {
        return sendJson(res, 200, s.readFile(p));
      } catch (err) {
        throw new HttpError(404, vfsMessage(err));
      }
    }
    if (sub === 'file' && method === 'PUT') {
      const body = await readJson(req);
      if (typeof body.path !== 'string' || !body.path || typeof body.content !== 'string') {
        throw new HttpError(400, 'path and content must be strings');
      }
      try {
        s.writeFile(body.path, body.content);
      } catch (err) {
        throw new HttpError(400, vfsMessage(err));
      }
      return sendJson(res, 200, { ok: true });
    }
    if (sub === 'share' && method === 'POST') {
      if (!opts.reviews) throw new HttpError(404, s.copy.errors.sharingOff);
      let id = shared.get(s.id);
      if (!id) {
        const snap = snapshot(s);
        if (!snap) throw new HttpError(409, s.copy.errors.notOver);
        const saved = await opts.reviews.save(snap);
        if (!saved) throw new HttpError(503, s.copy.errors.sharingDown);
        id = saved.id;
        shared.set(s.id, id);
      }
      return sendJson(res, 200, { id, path: `/r/${id}` });
    }
    if (sub === 'report' && method === 'POST') {
      const body = await readJson(req);
      const message = typeof body.message === 'string' ? body.message : undefined;
      if (!s.report(message)) throw new HttpError(409, s.copy.errors.noInstruction);
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // Another site may not make a visitor's browser start shifts or run commands here.
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res, 403, { error: 'Cross-site requests are not allowed' });
      return;
    }
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else {
        log('request failed: internal error');
        sendJson(res, 500, { error: 'Internal error' });
      }
    });
  });

  return {
    server,
    sessions,
    async close() {
      clearInterval(sweeper);
      for (const s of sessions.values()) s.dispose();
      sessions.clear();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
