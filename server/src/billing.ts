// What model calls on the server's key cost a signed-in player. Each call is priced at what the
// gateway charged for it (its cost in the response), else at the model's catalogue prices; then
// multiplied (2x by default) and taken off the account's credit. A price that cannot be found is
// never 0: the call is charged at FALLBACK_PRICE, dearer than every model on offer.

import { createGateway } from 'ai';
import { MICROS } from './accounts.ts';
import type { Accounts } from './accounts.ts';
import type { Allowance, CallUsage, DailyBudget } from './limits.ts';

/** US dollars per token. */
export interface Price {
  input: number;
  output: number;
  /** Prompt-cache reads; the input price when the catalogue has none. */
  cachedInput: number;
}

/** For a model the catalogue does not price (or that never answered): Sonnet-class prices. */
export const FALLBACK_PRICE: Price = { input: 5e-6, output: 25e-6, cachedInput: 0.5e-6 };

const PRICES_MS = 60 * 60_000;

/** Prices from the Vercel AI Gateway's public catalogue; null when it did not answer. */
export async function gatewayPrices(): Promise<Map<string, Price> | null> {
  try {
    const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || undefined });
    const res = await gateway.getAvailableModels();
    const map = new Map<string, Price>();
    for (const m of res.models) {
      const p = m.pricing;
      const input = Number(p?.input);
      const output = Number(p?.output);
      if (!p || !Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) continue;
      const cached = Number(p.cachedInputTokens);
      map.set(m.id, { input, output, cachedInput: Number.isFinite(cached) && cached > 0 ? cached : input });
    }
    return map;
  } catch {
    console.error('model price request failed');
    return null;
  }
}

/** The dollar cost a provider reported for a call, from the AI SDK's providerMetadata (the gateway's `cost`). */
export function reportedCost(providerMetadata: unknown): number | undefined {
  const gateway = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway;
  const cost = typeof gateway?.cost === 'string' ? Number(gateway.cost) : gateway?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : undefined;
}

export class Pricing {
  private readonly load: () => Promise<Map<string, Price> | null>;
  private readonly log: (line: string) => void;
  private prices = new Map<string, Price>();
  private until = 0;
  private loading: Promise<void> | null = null;
  /** Models already logged as unpriced, so the log says it once. */
  private readonly unpriced = new Set<string>();

  constructor(load: () => Promise<Map<string, Price> | null> = gatewayPrices, log: (line: string) => void = console.log) {
    this.load = load;
    this.log = log;
  }

  /** Fetches the catalogue's prices when they are older than an hour; a failed fetch is tried again in a minute. */
  refresh(): Promise<void> {
    if (Date.now() < this.until) return Promise.resolve();
    this.loading ??= this.load()
      .then((found) => {
        if (found?.size) {
          this.prices = found;
          this.until = Date.now() + PRICES_MS;
        } else this.until = Date.now() + 60_000;
      })
      .catch(() => {
        this.until = Date.now() + 60_000;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  priceOf(model: string): Price {
    const known = this.prices.get(model);
    if (known) return known;
    if (!this.unpriced.has(model)) {
      this.unpriced.add(model);
      this.log(`no price for ${model}; charging the fallback price`);
    }
    return FALLBACK_PRICE;
  }

  /** What one call cost in dollars, before the multiplier. */
  costOf(call: CallUsage): number {
    if (call.cost !== undefined && Number.isFinite(call.cost) && call.cost > 0) return call.cost;
    if (call.inputTokens <= 0 && call.outputTokens <= 0) return 0;
    const p = this.priceOf(call.model);
    const cached = Math.min(Math.max(0, call.cachedInputTokens ?? 0), call.inputTokens);
    return (call.inputTokens - cached) * p.input + cached * p.cachedInput + call.outputTokens * p.output;
  }
}

/** Billing settings for accounts. */
export interface Billing {
  pricing: Pricing;
  /** What a call costs the player, as a multiple of what it cost us. Default 2. */
  multiplier: number;
  /** Credit needed to start a shift, in micro-dollars. */
  floor: number;
}

/**
 * A signed-in player's shift on the server's key: each call is charged to the account at its price
 * times the multiplier, and the shift stops spending when the credit is gone. Calls also count
 * toward the daily budget, which never stops an account.
 */
export function creditAllowance(store: Accounts, account: string, billing: Pick<Billing, 'pricing' | 'multiplier'>, daily: DailyBudget | null): Allowance {
  return {
    kind: 'credit',
    canSpend: () => store.balance(account) > 0,
    spend(tokens, call) {
      daily?.spend(tokens);
      if (!call) return;
      const micros = Math.ceil(billing.pricing.costOf(call) * billing.multiplier * MICROS);
      if (micros > 0) store.charge(account, micros);
    },
  };
}

/** "0.25" or "$10" to micro-dollars; the fallback for anything else. */
export function dollars(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(/^\$/, ''));
  return Number.isFinite(n) && n >= 0 && raw ? Math.round(n * MICROS) : Math.round(fallback * MICROS);
}

/** FREEMIUS_TOPUPS ("<planId>:10,<planId>:20,..."): plan id to dollars. */
export function parseTopUps(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (raw ?? '').split(',')) {
    const m = /^\s*(\d{1,20})\s*:\s*\$?(\d+(?:\.\d{1,2})?)\s*$/.exec(part);
    if (m && Number(m[2]) > 0) out[m[1]] = Number(m[2]);
  }
  return out;
}
