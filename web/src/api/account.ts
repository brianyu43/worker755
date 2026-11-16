// The signed-in player, their usage, and topping it up. Separate from the game client: the offline
// mock has no accounts, and a server without sign-in answers with nothing to sign in with.
import { ApiError } from './errors';
import { client } from './client';
import { t } from '../i18n';

export type SignInProvider = 'google' | 'github';

/** An account's usage in dollars: what is left, of what it had after the last top-up (or the starter). */
export interface Usage {
  left: number;
  of: number;
  /** Has topped up: every model on offer may be picked. */
  topUp: boolean;
}

export interface Me {
  /** Ways to sign in; empty when shifts on the server's key need no account. */
  signIn: SignInProvider[];
  account: { name: string; email: string; usage: Usage } | null;
  /** Top-up amounts on sale, in dollars; empty when payments are off. */
  topUps: number[];
  /** Usage needed to clock in, in dollars. */
  floor: number;
}

export const NO_ACCOUNT: Me = { signIn: [], account: null, topUps: [], floor: 0 };

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
  if (client.kind === 'mock') return NO_ACCOUNT;
  return { ...NO_ACCOUNT, ...(await call<Partial<Me>>('GET', '/api/me')) };
}

export const signInUrl = (provider: SignInProvider) => `/api/auth/${provider}?next=${encodeURIComponent(location.pathname)}`;

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' }).catch(() => {});
}

/** Freemius's checkout page for a top-up of this many dollars. */
export async function checkoutUrl(language: string, amount: number): Promise<string> {
  return (await call<{ url: string }>('POST', '/api/billing/checkout', { language, amount })).url;
}

/** Whether the account has too little usage left to clock in. */
export const atLimit = (me: Me | null) => !!me?.account && me.account.usage.left < Math.max(me.floor, 0.000001);

/** $6.20 */
export const dollars = (n: number) => `$${n.toFixed(2)}`;
