// Top-ups sold through Freemius, the merchant of record: one plan per amount ($10, $20, ...). The
// player opens Freemius's hosted checkout with their email fixed; each purchase is a license, and each
// license adds its plan's amount to the account's credit. The buyer's return and Freemius's webhooks
// are only hints: the license is fetched from Freemius and credited once, or its credit taken back
// (as much as is left) when Freemius no longer has it (a refund). Licenses of plans that are not
// top-ups, such as the old shift packs, are never credited again; their refunds still take back what
// they added.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MICROS } from './accounts.ts';
import type { Accounts } from './accounts.ts';

export interface FreemiusConfig {
  productId: string;
  /** Top-up plans: plan id to the dollars it adds (FREEMIUS_TOPUPS). */
  topUps: Record<string, number>;
  publicKey: string;
  secretKey: string;
  /** Bearer token for Freemius's API. */
  apiKey: string;
  /** Test cards only. */
  sandbox: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

/** Hex HMAC-SHA256 compared in constant time. */
export function signed(secret: string, data: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const mac = createHmac('sha256', secret).update(data).digest('hex');
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature, 'hex'));
}

export class Freemius {
  readonly config: FreemiusConfig;
  private readonly accounts: Accounts;
  private readonly request: typeof fetch;
  private readonly log: (line: string) => void;

  constructor(config: FreemiusConfig, accounts: Accounts) {
    this.config = config;
    this.accounts = accounts;
    this.request = config.fetch ?? fetch;
    this.log = config.log ?? (() => {});
  }

  /** The top-up amounts on sale, in dollars, smallest first. */
  amounts(): number[] {
    return [...new Set(Object.values(this.config.topUps))].sort((a, b) => a - b);
  }

  /** The plan that sells this many dollars of credit. */
  planFor(amount: unknown): string | null {
    const hit = Object.entries(this.config.topUps).find(([, usd]) => usd === amount);
    return hit ? hit[0] : null;
  }

  /** The hosted checkout for one top-up plan, for this account and email. */
  checkoutUrl(accountId: string, email: string, planId: string, now = Date.now()): string {
    const c = this.config;
    this.accounts.openCheckout(accountId, email);
    const url = new URL(`https://checkout.freemius.com/product/${c.productId}/plan/${planId}/`);
    url.searchParams.set('user_email', email);
    url.searchParams.set('readonly_user', 'true');
    url.searchParams.set('billing_cycle', 'lifetime');
    if (c.sandbox) {
      const ctx = String(Math.floor(now / 1000));
      url.searchParams.set('s_ctx_ts', ctx);
      url.searchParams.set('sandbox', createHash('md5').update(`${ctx}${c.productId}${c.secretKey}${c.publicKey}checkout`).digest('hex'));
    }
    return url.href;
  }

  private async api(path: string): Promise<Record<string, unknown> | null> {
    const res = await this.request(`https://api.freemius.com/v1/products/${this.config.productId}/${path}`, {
      headers: { authorization: `Bearer ${this.config.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Freemius API answered HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Looks up a license and brings its top-up up to date: credited once while Freemius has it, taken
   * back once it is gone. Returns the account it belongs to, when one is known.
   */
  async sync(licenseId: unknown): Promise<string | null> {
    if (!/^\d{1,20}$/.test(String(licenseId ?? ''))) return null;
    const id = String(licenseId);
    const license = await this.api(`licenses/${id}.json`);
    if (!license?.id) {
      const from = this.accounts.refund(id);
      if (from) this.log(`freemius: license ${id} gone, credit taken back`);
      return from;
    }
    const amount = this.config.topUps[String(license.plan_id)];
    if (!amount) return null;
    const user = license.user_id ? await this.api(`users/${String(license.user_id)}.json`) : null;
    const email = typeof user?.email === 'string' ? user.email : '';
    const owner = this.accounts.ownerOf(id, email);
    if (!owner) {
      this.log(`freemius: license ${id} matches no account; add the credit by hand`);
      return null;
    }
    if (this.accounts.credit(id, owner, Math.round(amount * MICROS))) this.log(`freemius: license ${id} credited $${amount}`);
    return owner;
  }

  /** A webhook: signed with the product's secret key. Refunds take the credit back; anything else syncs it. */
  async receive(raw: string, signature: unknown): Promise<boolean> {
    if (!signed(this.config.secretKey, raw, signature)) return false;
    let event: { type?: unknown; objects?: Record<string, { id?: unknown; license_id?: unknown } | undefined>; data?: { license_id?: unknown } };
    try {
      event = JSON.parse(raw);
    } catch {
      return true;
    }
    const o = event.objects ?? {};
    const licenseId = o.license?.id ?? event.data?.license_id ?? o.payment?.license_id ?? o.subscription?.license_id;
    if (!licenseId) return true;
    if (typeof event.type === 'string' && /refund/.test(event.type)) {
      if (this.accounts.refund(String(licenseId))) this.log(`freemius: license ${String(licenseId)} refunded, credit taken back`);
      return true;
    }
    await this.sync(licenseId);
    return true;
  }

  /** Back from the checkout: Freemius signs the whole return URL (signature last); a valid one syncs at once. */
  async returned(fullUrl: string): Promise<void> {
    const href = fullUrl.replace(/%20/g, '+');
    const at = href.search(/[?&]signature=/);
    const url = new URL(href);
    if (at > 0 && signed(this.config.secretKey, href.slice(0, at), url.searchParams.get('signature'))) {
      await this.sync(url.searchParams.get('license_id')).catch(() => this.log('freemius: return sync failed'));
    }
  }
}
