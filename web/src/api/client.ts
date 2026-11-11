import type { ExecResponse, GameEvent, ModelList, Provider, SessionState, SharedReview, Workplace } from './types';
import { ApiError } from './errors';
import { createMockClient } from './mock';
import { t } from '../i18n';

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
  exec(id: string, line: string): Promise<ExecResponse>;
  readFile(id: string, path: string): Promise<{ path: string; content: string }>;
  writeFile(id: string, path: string, content: string): Promise<{ ok: true }>;
  report(id: string, message?: string): Promise<{ ok: true }>;
  /** Saves a finished shift's review under a public link. */
  share(id: string): Promise<{ id: string; path: string }>;
  getReview(id: string): Promise<SharedReview>;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

function createRealClient(): GameClient {
  const s = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
  return {
    kind: 'real',
    getModels: (provider) =>
      request<ModelList>('GET', provider ? `/api/models?provider=${encodeURIComponent(provider)}` : '/api/models'),
    createSession: ({ model, allowSkip, subagent, scenario, director, apiKey, provider, language }) =>
      request<SessionState>('POST', '/api/sessions', {
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey, provider } : {}),
        allowSkip: allowSkip === true,
        subagent: subagent ?? '',
        scenario: scenario ?? 'fresh',
        director: director || 'scripted',
        language: language ?? 'en',
      }),
    getSession: (id) => request<SessionState>('GET', s(id)),
    exec: (id, line) => request<ExecResponse>('POST', `${s(id)}/exec`, { line }),
    readFile: (id, path) =>
      request<{ path: string; content: string }>('GET', `${s(id)}/file?path=${encodeURIComponent(path)}`),
    writeFile: (id, path, content) => request<{ ok: true }>('PUT', `${s(id)}/file`, { path, content }),
    report: (id, message) =>
      request<{ ok: true }>('POST', `${s(id)}/report`, message ? { message } : {}),
    share: (id) => request<{ id: string; path: string }>('POST', `${s(id)}/share`),
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
