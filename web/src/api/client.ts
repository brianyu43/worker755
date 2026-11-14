import type { ExecResponse, GameEvent, KeyModels, ModelList, Provider, SessionState, SharedReview, Workplace } from './types';
import type { Face } from '../game/avatar';
import { ApiError } from './errors';
import { createMockClient } from './mock';
import { t } from '../i18n';
import { LocalShell } from '../shell/local';
import type { Snapshot } from '../shell/local';
import type { Change } from '../shell/protocol';

export { ApiError };

export interface Subscription {
  close(): void;
}

export interface NewSession {
  language?: string;
  model?: string;
  allowSkip?: boolean;
  /** Model name the manager is told its subagent runs on. */
  subagent?: string;
  scenario?: Workplace;
  /** Model writing the director's messages; empty for scripted lines. */
  director?: string;
  /** The player's own key; without it the shift is a free one on the server's key. */
  apiKey?: string;
  provider?: Provider;
  /** The player's rewrite of what the manager is told about them; unset keeps the default. */
  stance?: string;
}

export interface SubscribeHandlers {
  onEvent(event: GameEvent): void;
  onConnection?(connected: boolean): void;
}

/** The only way the UI talks to the game server. */
export interface GameClient {
  readonly kind: 'real' | 'mock';
  /** Free-shift models, or what a player's own key can use with `provider`. */
  getModels(provider?: Provider): Promise<ModelList>;
  createSession(opts: NewSession): Promise<SessionState>;
  getSession(id: string): Promise<SessionState>;
  /** Streams events with seq > after. Reconnects on its own, resuming after the last seq seen. */
  subscribe(id: string, after: number, handlers: SubscribeHandlers): Subscription;
  /** Runs a command line in the player's shell. */
  exec(id: string, line: string): Promise<ExecResponse>;
  readFile(id: string, path: string): Promise<{ path: string; content: string }>;
  writeFile(id: string, path: string, content: string): Promise<{ ok: true }>;
  /** Every command name the player's shell knows, for Tab completion. */
  commandNames(id: string): Promise<string[]>;
  report(id: string, message?: string): Promise<{ ok: true }>;
  /** Saves a finished shift's review under a public link. */
  share(id: string, face: Face): Promise<{ id: string; path: string }>;
  getReview(id: string): Promise<SharedReview>;
  /** Goes on with a paused shift on the player's own key; the manager may become another model. */
  continueShift(id: string, key: { provider: Provider; apiKey: string; model: string }): Promise<{ ok: true; model: string }>;
  /** Ends the shift now, paused or not; the manager writes the review. */
  finishShift(id: string): Promise<{ ok: true }>;
  /** Checks a player's key with its provider and lists every model it can use. */
  checkKey(key: { provider: Provider; apiKey: string; language: string }): Promise<KeyModels>;
}

/**
 * The secret the server hands to the browser that starts a shift; only it may play the shift, while
 * the link alone lets someone watch. Kept per shift id, for the last few shifts.
 */
const OWNED = 'w755.owned';

function ownedShifts(): [string, string][] {
  try {
    const v = JSON.parse(localStorage.getItem(OWNED) ?? '[]');
    return Array.isArray(v) ? v.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : [];
  } catch {
    return [];
  }
}

function rememberOwner(id: string, token: string): void {
  try {
    localStorage.setItem(OWNED, JSON.stringify([[id, token], ...ownedShifts().filter(([k]) => k !== id)].slice(0, 20)));
  } catch {
    /* private mode: the shift still works in this tab */
  }
  memoryOwned.set(id, token);
}

const memoryOwned = new Map<string, string>();

function owner(id: string): Record<string, string> {
  const token = memoryOwned.get(id) ?? ownedShifts().find(([k]) => k === id)?.[1];
  return token ? { 'X-Session-Token': token } : {};
}

async function request<T>(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t('errors.offline'));
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : t('errors.request', { status: res.status });
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SyncBody {
  epoch: number;
  cwd: string;
  changes: Change[];
  command?: { line: string; output: string; exitCode: number };
  edit?: { path: string; bytes: number };
}

function createRealClient(): GameClient {
  const s = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

  // The shell runs here, in a Web Worker; the server keeps a copy of the files for the manager and the
  // checks. Each shift's shell starts from the server's files.
  const shells = new Map<string, Promise<LocalShell>>();
  const snapshot = (id: string) => request<Snapshot>('GET', `${s(id)}/fs`, undefined, owner(id));
  const shellFor = (id: string): Promise<LocalShell> => {
    let sh = shells.get(id);
    if (!sh) {
      const token = owner(id)['X-Session-Token'];
      sh = snapshot(id).then((snap) => LocalShell.start(snap, token ? { base: s(id), token } : null));
      sh.catch(() => shells.delete(id));
      shells.set(id, sh);
    }
    return sh;
  };

  /**
   * Sends the server what commands and saves changed, oldest first. A send that cannot get through (no
   * network, rate limit, server trouble) stays in the backlog and goes first next time, so the server's
   * copy always follows the shell in order. When the server asks (a mission seed crossed a command, or
   * changes did not fit), the shell reloads the server's files once the backlog is through, so both sides
   * agree again. Runs inside the shell's queue. False while something is still waiting to be sent.
   */
  const backlogs = new Map<string, SyncBody[]>();
  const sync = async (id: string, sh: LocalShell, body: SyncBody): Promise<boolean> => {
    const backlog = backlogs.get(id) ?? [];
    backlogs.set(id, backlog);
    backlog.push(body);
    let reload = false;
    let attempt = 0;
    while (backlog.length) {
      try {
        const r = await request<{ resync: boolean }>('POST', `${s(id)}/sync`, backlog[0], owner(id));
        backlog.shift();
        attempt = 0;
        if (r.resync) reload = true;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 400 || status === 413) {
          backlog.shift();
          reload = true;
          continue;
        }
        if (status === 403 || status === 404) {
          backlog.length = 0;
          break;
        }
        if (attempt++ < 4) {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        return false;
      }
    }
    if (reload) await sh.reload(await snapshot(id));
    return true;
  };

  return {
    kind: 'real',
    getModels: (provider) =>
      request<ModelList>('GET', provider ? `/api/models?provider=${encodeURIComponent(provider)}` : '/api/models'),
    createSession: async ({ model, allowSkip, subagent, scenario, director, apiKey, provider, language, stance }) => {
      const { token, ...state } = await request<SessionState & { token?: string }>('POST', '/api/sessions', {
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey, provider } : {}),
        allowSkip: allowSkip === true,
        subagent: subagent ?? '',
        scenario: scenario ?? 'fresh',
        director: director || 'scripted',
        language: language ?? 'en',
        ...(stance !== undefined ? { stance } : {}),
      });
      if (token) rememberOwner(state.id, token);
      return state;
    },
    getSession: (id) => request<SessionState>('GET', s(id)),
    async exec(id, line) {
      const sh = await shellFor(id);
      // The command and its sync are one step, so the server's copy follows the shell in order.
      return sh.exclusive(async () => {
        const r = await sh.execNow(line);
        let synced = true;
        if (line.trim() && !r.killed) {
          synced = await sync(id, sh, {
            epoch: r.epoch,
            cwd: r.cwd,
            changes: r.changes,
            command: { line, output: r.result.stdout + r.result.stderr, exitCode: r.result.exitCode },
          });
        }
        return { ...r.result, cwd: r.cwd, killed: r.killed, unsynced: !synced };
      });
    },
    async readFile(id, path) {
      const sh = await shellFor(id);
      try {
        return await sh.read(path);
      } catch (e) {
        throw new ApiError(404, e instanceof Error ? e.message : 'not found');
      }
    },
    async writeFile(id, path, content) {
      const sh = await shellFor(id);
      await sh.exclusive(async () => {
        const w = await sh.writeNow(path, content);
        // Saved here either way; without a connection the save waits in the backlog for the server.
        const bytes = new TextEncoder().encode(content).length;
        await sync(id, sh, { epoch: w.epoch, cwd: w.cwd, changes: w.changes, edit: { path: w.path, bytes } });
      });
      return { ok: true };
    },
    commandNames: async (id) => (await shellFor(id)).names(),
    report: (id, message) =>
      request<{ ok: true }>('POST', `${s(id)}/report`, message ? { message } : {}, owner(id)),
    share: (id, face) => request<{ id: string; path: string }>('POST', `${s(id)}/share`, { face }, owner(id)),
    continueShift: (id, key) => request<{ ok: true; model: string }>('POST', `${s(id)}/continue`, key, owner(id)),
    finishShift: (id) => request<{ ok: true }>('POST', `${s(id)}/finish`, undefined, owner(id)),
    checkKey: (key) => request<KeyModels>('POST', '/api/models/check', key),
    getReview: (id) => request<SharedReview>('GET', `/api/reviews/${encodeURIComponent(id)}`),
    subscribe(id, after, handlers) {
      let lastSeq = after;
      let closed = false;
      let connected: boolean | null = null;
      let backoff = 500;
      const abort = new AbortController();
      const setConnected = (value: boolean) => {
        if (connected === value) return;
        connected = value;
        handlers.onConnection?.(value);
      };

      // Long polling rather than EventSource: some tunnels and proxies buffer event streams.
      const loop = async () => {
        while (!closed) {
          try {
            const res = await fetch(`${s(id)}/events?poll=1&after=${lastSeq}`, { signal: abort.signal });
            if (!res.ok) throw new Error('poll failed');
            const data = (await res.json()) as { events?: GameEvent[] };
            backoff = 500;
            setConnected(true);
            for (const event of data.events ?? []) {
              if (typeof event.seq !== 'number' || event.seq <= lastSeq) continue;
              lastSeq = event.seq;
              // Only the shift's own browser runs a shell; a watcher has none to update.
              if (event.type === 'seed' && shells.has(id)) void shellFor(id).then((sh) => sh.applySeed(event.epoch, event.changes));
              handlers.onEvent(event);
            }
          } catch {
            if (closed) return;
            setConnected(false);
            await new Promise((r) => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, 8000);
          }
        }
      };
      void loop();
      return {
        close() {
          closed = true;
          abort.abort();
        },
      };
    },
  };
}

function mockEnabled(): boolean {
  if (import.meta.env.VITE_MOCK === '1') return true;
  try {
    return new URLSearchParams(window.location.search).get('mock') === '1';
  } catch {
    return false;
  }
}

export const client: GameClient = mockEnabled() ? createMockClient() : createRealClient();
