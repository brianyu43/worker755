import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Accounts } from '../src/accounts.ts';
import { createApp } from '../src/http.ts';
import { Freemius } from '../src/freemius.ts';
import { safeNext, sessionCookie } from '../src/auth.ts';
import { assistant, call } from '../src/manager.ts';
import type { ManagerDriver } from '../src/manager.ts';
import type { Session } from '../src/session.ts';
import type { GameEvent } from '../src/types.ts';
import { exec } from './player.ts';

test('accounts: one free shift on sign-up, one account per verified email, free shifts go first', () => {
  const a = new Accounts(':memory:', 1);
  const { account, created } = a.signIn('google', 'g1', 'Ann@example.com', 'Ann');
  assert.equal(created, true);
  assert.equal(account.freeShifts, 1);
  const again = a.signIn('github', '77', 'ann@example.com', 'ann-gh');
  assert.equal(again.created, false);
  assert.equal(again.account.id, account.id);
  assert.equal(again.account.name, 'Ann');
  assert.equal(a.signIn('github', '77', '', '').account.id, account.id);

  assert.equal(a.credit('L1', account.id, 10), true);
  assert.equal(a.credit('L1', account.id, 10), false, 'a license is credited once');
  assert.equal(a.take(account.id), 'free');
  assert.equal(a.take(account.id), 'paid');
  assert.equal(a.get(account.id)!.paidShifts, 9);
  a.giveBack(account.id, 'paid');
  assert.equal(a.get(account.id)!.paidShifts, 10);
  assert.equal(a.refund('L1'), account.id);
  assert.equal(a.refund('L1'), null, 'a refund is taken back once');
  assert.equal(a.get(account.id)!.paidShifts, 0);
  assert.equal(a.take(account.id), null);
});

test('a license finds its buyer by the checkout opened with the same email', () => {
  const a = new Accounts(':memory:', 0);
  const one = a.signIn('google', 'g1', 'one@example.com', '').account;
  a.openCheckout(one.id, 'one@example.com');
  assert.equal(a.ownerOf('L9', 'ONE@example.com'), one.id);
  assert.equal(a.ownerOf('L9', ''), one.id, 'claimed for good');
  assert.equal(a.ownerOf('L10', 'one@example.com'), null, 'one checkout, one license');
});

test('sign-in only sends players back to this site', () => {
  assert.equal(safeNext('/play?x=1'), '/play?x=1');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.equal(safeNext('/\\evil.example'), '/');
});

const SECRET = 'test-secret';
const FM_SECRET = 'fm-secret';

/** Google's token endpoint, and Freemius's API with one license of the pack's plan. */
function fakeProviders(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const claims = { iss: 'https://accounts.google.com', aud: 'gid', sub: 'g-42', email: 'p@example.com', email_verified: true, name: 'Pat', exp: Date.now() / 1000 + 600 };
      return Response.json({ id_token: `${b64({ alg: 'none' })}.${b64(claims)}.sig` });
    }
    if (url.endsWith('/licenses/555.json')) return Response.json({ id: 555, plan_id: 9, user_id: 3 });
    if (url.endsWith('/users/3.json')) return Response.json({ id: 3, email: 'p@example.com' });
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

test('a signed-in player plays their free shift, buys a pack through Freemius, and a refund takes it back', async () => {
  const store = new Accounts(':memory:', 1);
  const request = fakeProviders();
  const freemius = new Freemius(
    { productId: '1', planId: '9', publicKey: 'pk', secretKey: FM_SECRET, apiKey: 'api', sandbox: true, shifts: 10, price: '$9.90', fetch: request },
    store,
  );
  const app = createApp({
    mock: true,
    timeoutMs: 5000,
    mockDelayMs: 0,
    openPerAddress: 1000,
    log: () => {},
    accounts: { store, auth: { secret: SECRET, google: { id: 'gid', secret: 'gsecret' }, fetch: request }, freemius },
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    let cookies = '';
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(base + path, {
        method,
        redirect: 'manual',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookies ? { cookie: cookies } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
    const keep = (res: Response) => {
      const jar = new Map(cookies.split('; ').filter(Boolean).map((c) => c.split('=') as [string, string]));
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const at = pair.indexOf('=');
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      cookies = [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
    };

    assert.equal((await call('POST', '/api/sessions', {})).status, 401, 'no shift on our key without signing in');
    assert.deepEqual((await (await call('GET', '/api/me')).json()).signIn, ['google']);
    assert.equal((await call('GET', '/api/auth/github')).status, 404);

    const start = await call('GET', '/api/auth/google?next=/play');
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location')!);
    assert.equal(to.host, 'accounts.google.com');
    assert.equal(to.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
    keep(start);
    const forged = await call('GET', '/api/auth/google/callback?code=c&state=wrong');
    assert.equal(forged.headers.get('location'), '/?signin=failed');
    const back = await call('GET', `/api/auth/google/callback?code=c&state=${to.searchParams.get('state')}`);
    assert.equal(back.headers.get('location'), '/play');
    keep(back);
    const me = await (await call('GET', '/api/me')).json();
    assert.deepEqual(me.account, { name: 'Pat', email: 'p@example.com', shifts: 1, bought: 0 });
    assert.deepEqual(me.pack, { shifts: 10, price: '$9.90' });

    assert.equal((await call('POST', '/api/sessions', {})).status, 201);
    assert.equal((await call('POST', '/api/sessions', {})).status, 402, 'the free shift is played');

    const checkout = await (await call('POST', '/api/billing/checkout', {})).json();
    const co = new URL(checkout.url);
    assert.equal(co.host, 'checkout.freemius.com');
    assert.equal(co.searchParams.get('user_email'), 'p@example.com');
    assert.ok(co.searchParams.get('sandbox'));

    const event = JSON.stringify({ type: 'license.created', objects: { license: { id: 555 } } });
    const sig = (s: string) => createHmac('sha256', FM_SECRET).update(s).digest('hex');
    assert.equal((await call('POST', '/api/billing/webhook', event, { 'x-signature': 'f'.repeat(64) })).status, 401);
    assert.equal((await call('POST', '/api/billing/webhook', event, { 'x-signature': sig(event) })).status, 200);
    assert.equal((await call('POST', '/api/billing/webhook', event, { 'x-signature': sig(event) })).status, 200);
    assert.equal((await (await call('GET', '/api/me')).json()).account.bought, 10, 'one pack, credited once');
    assert.equal((await call('POST', '/api/sessions', {})).status, 201);

    const refund = JSON.stringify({ type: 'payment.refund', objects: { payment: { license_id: 555 } } });
    assert.equal((await call('POST', '/api/billing/webhook', refund, { 'x-signature': sig(refund) })).status, 200);
    assert.equal((await (await call('GET', '/api/me')).json()).account.shifts, 0);

    keep(await call('POST', '/api/auth/signout'));
    assert.equal((await (await call('GET', '/api/me')).json()).account, null);
  } finally {
    await app.close();
  }
});

function waitFor(s: Session, pred: (e: GameEvent) => boolean, timeoutMs = 5000): Promise<GameEvent> {
  const found = s.events.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for event'));
    }, timeoutMs);
    const off = s.subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

test("an account's shifts are its only limit: no token cap, and a spent daily pool stops nothing", async () => {
  const store = new Accounts(':memory:', 1);
  const player = store.signIn('google', 'g1', 'p@example.com', 'Pat').account;
  store.credit('L1', player.id, 1);
  // Every manager call reports far more tokens than the shift or the whole day may use. It gives
  // one instruction per task and signs the task off once the subagent reports.
  const heavy = (): ManagerDriver => {
    let instructed = false;
    return {
      model: 'a/one',
      async step(req) {
        let res = assistant('Review.', []);
        if (req.tools) {
          res = instructed
            ? assistant('', [call('MissionComplete', { summary: 'Done.' })])
            : assistant('', [call('Agent', { description: 'Do it', prompt: 'Create the file.' })]);
          instructed = !instructed;
        }
        return { ...res, usage: { inputTokens: 100_000, outputTokens: 0 } };
      },
    };
  };
  const app = createApp({
    mock: false,
    timeoutMs: 5000,
    openPerAddress: 1000,
    log: () => {},
    models: async () => [{ id: 'a/one', label: 'One' }],
    driverFor: heavy,
    free: { sessionTokens: 10, dailyTokens: 10, perAddressPerDay: 1, credentials: { provider: 'gateway', apiKey: 'hosted-key-0123456789abcdef' } },
    accounts: { store, auth: { secret: SECRET } },
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const cookie = sessionCookie(SECRET, player.id, false).split(';')[0];
  const start = () => fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  try {
    const first = await start();
    assert.equal(first.status, 201);
    const s = app.sessions.get((await first.json()).id)!;
    // The game clock starts once the page watches the shift.
    s.start();
    const count = (type: GameEvent['type']) => s.events.filter((e) => e.type === type).length;
    for (let n = 1; ; n++) {
      const next = await waitFor(s, (e) => e.type === 'game_over' || e.type === 'paused' || (e.type === 'instruction' && count('instruction') === n));
      if (next.type !== 'instruction') break;
      exec(s, 'echo done > done.txt');
      s.report('Done.');
    }
    assert.equal(count('paused'), 0, 'never paused for a key');
    assert.equal(count('game_over'), 1, 'played to the end');
    assert.equal(count('mission_end'), s.missions.length);
    assert.equal(count('error'), 0);
    assert.equal((await start()).status, 201, 'the bought shift plays with the daily pool spent');
    assert.equal((await start()).status, 402, 'then the account is out of shifts');
  } finally {
    await app.close();
  }
});
