// The signed-in player, their shifts, and buying more. Separate from the game client: the offline
// mock has no accounts, and a server without sign-in answers with nothing to sign in with.
import { ApiError } from './errors';
import { client } from './client';
import { t } from '../i18n';

export type SignInProvider = 'google' | 'github';

export interface Me {
  /** Ways to sign in; empty when shifts on the server's key need no account. */
  signIn: SignInProvider[];
  account: { name: string; email: string; shifts: number } | null;
  /** A pack of shifts on sale, when payments are on. */
  pack: { shifts: number; price: string } | null;
}

const NONE: Me = { signIn: [], account: null, pack: null };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(0, t('errors.offline'));
  }
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (!res.ok) throw new ApiError(res.status, typeof data?.error === 'string' ? data.error : t('errors.request', { status: res.status }));
  return data as T;
}

export async function getMe(): Promise<Me> {
  if (client.kind === 'mock') return NONE;
  return { ...NONE, ...(await call<Partial<Me>>('GET', '/api/me')) };
}

export const signInUrl = (provider: SignInProvider) => `/api/auth/${provider}?next=${encodeURIComponent(location.pathname)}`;

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' }).catch(() => {});
}

/** Freemius's checkout page for one pack. */
export async function checkoutUrl(language: string): Promise<string> {
  return (await call<{ url: string }>('POST', '/api/billing/checkout', { language })).url;
}
