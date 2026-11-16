// Sign-in with Google or GitHub, by the OAuth code flow, and the cookie that keeps a player signed in.
// The cookie holds the account id and an expiry, signed with AUTH_SECRET; nothing else is stored.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Provider } from './accounts.ts';

export const SESSION_COOKIE = 'w755_session';
const STATE_COOKIE = 'w755_oauth';
const SESSION_MS = 180 * 24 * 60 * 60_000;
const STATE_MS = 10 * 60_000;

export interface OAuthClient {
  id: string;
  secret: string;
}

export interface AuthConfig {
  /** Signs the cookies. */
  secret: string;
  google?: OAuthClient;
  github?: OAuthClient;
  /** Overrides calls to the providers (tests). */
  fetch?: typeof fetch;
}

/** Who signed in, as the provider vouches for them. */
export interface Identity {
  provider: Provider;
  subject: string;
  email: string;
  name: string;
}

export class AuthFailed extends Error {}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function sign(secret: string, value: string): string {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

function unsign(secret: string, signed: string): string | null {
  const at = signed.lastIndexOf('.');
  if (at <= 0) return null;
  const value = signed.slice(0, at);
  const mac = Buffer.from(signed.slice(at + 1), 'base64url');
  const want = createHmac('sha256', secret).update(value).digest();
  return mac.length === want.length && timingSafeEqual(mac, want) ? value : null;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

function cookie(name: string, value: string, maxAgeMs: number, secure: boolean, path = '/'): string {
  return (
    `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Lax` +
    (secure ? '; Secure' : '')
  );
}

/** The signed-in account id, or null. */
export function sessionAccount(secret: string, req: IncomingMessage, now = Date.now()): string | null {
  const raw = readCookie(req, SESSION_COOKIE);
  const value = raw ? unsign(secret, raw) : null;
  if (!value) return null;
  const [id, until] = value.split('~');
  return id && Number(until) > now ? id : null;
}

export function sessionCookie(secret: string, accountId: string, secure: boolean, now = Date.now()): string {
  return cookie(SESSION_COOKIE, sign(secret, `${accountId}~${now + SESSION_MS}`), SESSION_MS, secure);
}

export function signOutCookie(secure: boolean): string {
  return cookie(SESSION_COOKIE, '', 0, secure);
}

/** Only paths on this site, so a sign-in link cannot send the player elsewhere. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(next) && next.length < 200 ? next : '/';
}

/**
 * Where to send the player to sign in, and the cookie that remembers the attempt (its state, the
 * PKCE verifier and where to go after).
 */
export function beginSignIn(
  config: AuthConfig,
  provider: Provider,
  redirectUri: string,
  next: string,
  secure: boolean,
): { location: string; cookie: string } {
  const client = config[provider];
  if (!client) throw new AuthFailed('provider not configured');
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url =
    provider === 'google'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', client.id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'google') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('prompt', 'select_account');
  } else {
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('allow_signup', 'true');
  }
  const value = sign(config.secret, b64(JSON.stringify({ provider, state, verifier, next, until: Date.now() + STATE_MS })));
  return { location: url.href, cookie: cookie(STATE_COOKIE, value, STATE_MS, secure, '/api/auth') };
}

export function clearStateCookie(secure: boolean): string {
  return cookie(STATE_COOKIE, '', 0, secure, '/api/auth');
}

/** Back from the provider: checks the state, trades the code for who the player is. */
export async function finishSignIn(
  config: AuthConfig,
  provider: Provider,
  req: IncomingMessage,
  url: URL,
  redirectUri: string,
): Promise<{ identity: Identity; next: string }> {
  const client = config[provider];
  if (!client) throw new AuthFailed('provider not configured');
  const raw = readCookie(req, STATE_COOKIE);
  const value = raw ? unsign(config.secret, raw) : null;
  if (!value) throw new AuthFailed('no sign-in in progress');
  let saved: { provider?: string; state?: string; verifier?: string; next?: string; until?: number };
  try {
    saved = JSON.parse(unb64(value));
  } catch {
    throw new AuthFailed('bad state');
  }
  const code = url.searchParams.get('code');
  if (saved.provider !== provider || !saved.state || saved.state !== url.searchParams.get('state')) throw new AuthFailed('state mismatch');
  if (!saved.until || saved.until < Date.now()) throw new AuthFailed('sign-in took too long');
  if (!code) throw new AuthFailed('no code');
  const request = config.fetch ?? fetch;
  const identity =
    provider === 'google'
      ? await googleIdentity(request, client, code, saved.verifier ?? '', redirectUri)
      : await githubIdentity(request, client, code, saved.verifier ?? '', redirectUri);
  return { identity, next: safeNext(saved.next) };
}

async function postForm(request: typeof fetch, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AuthFailed(`token exchange failed (HTTP ${res.status})`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AuthFailed('token exchange answered no JSON');
  }
}

async function googleIdentity(request: typeof fetch, client: OAuthClient, code: string, verifier: string, redirectUri: string): Promise<Identity> {
  const token = await postForm(request, 'https://oauth2.googleapis.com/token', {
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  // The ID token comes straight from Google over TLS, so its claims are read without checking its signature.
  const idToken = typeof token.id_token === 'string' ? token.id_token : '';
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(unb64(idToken.split('.')[1] ?? ''));
  } catch {
    throw new AuthFailed('no ID token');
  }
  const iss = claims.iss;
  if ((iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') || claims.aud !== client.id) throw new AuthFailed('ID token not for us');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new AuthFailed('ID token expired');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthFailed('no subject');
  const email = claims.email_verified === true && typeof claims.email === 'string' ? claims.email : '';
  return { provider: 'google', subject: claims.sub, email, name: typeof claims.name === 'string' ? claims.name.slice(0, 80) : '' };
}

async function githubIdentity(request: typeof fetch, client: OAuthClient, code: string, verifier: string, redirectUri: string): Promise<Identity> {
  const token = await postForm(request, 'https://github.com/login/oauth/access_token', {
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const access = typeof token.access_token === 'string' ? token.access_token : '';
  if (!access) throw new AuthFailed('no access token');
  const get = async (path: string) => {
    const res = await request(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${access}`, accept: 'application/vnd.github+json', 'user-agent': 'worker755' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AuthFailed(`GitHub ${path} failed (HTTP ${res.status})`);
    return res.json() as Promise<unknown>;
  };
  const user = (await get('/user')) as { id?: unknown; login?: unknown; name?: unknown };
  if (typeof user.id !== 'number') throw new AuthFailed('no GitHub user');
  const emails = (await get('/user/emails').catch(() => [])) as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
  const primary = Array.isArray(emails) ? emails.find((e) => e.primary === true && e.verified === true) : undefined;
  const name = typeof user.name === 'string' && user.name ? user.name : typeof user.login === 'string' ? user.login : '';
  return {
    provider: 'github',
    subject: String(user.id),
    email: typeof primary?.email === 'string' ? primary.email : '',
    name: name.slice(0, 80),
  };
}
