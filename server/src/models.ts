import { createGateway } from 'ai';
import { DIRECT_MODELS, isDirect, providerModelId } from './providers.ts';
import type { ProviderId } from './providers.ts';

export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Inexpensive, tool-capable models from different vendors, cheapest-and-steadiest first.
 * Only the ones present in the provider's live catalogue are offered.
 */
export const PREFERRED_MODELS = [
  'anthropic/claude-haiku-5.5',
  'openai/gpt-6-luna',
  'google/gemini-3.1-flash-lite',
  'deepseek/deepseek-v4.1-flash',
  'zai/glm-5.3-flash',
  'moonshotai/kimi-k2.6',
  'anthropic/claude-sonnet-5.5',
];

export const MOCK_MODEL: ModelOption = { id: 'mock/manager', label: 'Scripted manager' };

const CACHE_MS = 10 * 60_000;
const cache = new Map<ProviderId, { at: number; list: ModelOption[] }>();

function envList(name: string): string[] {
  const raw = process.env[name] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function gatewayCatalogue(): Promise<Map<string, string> | null> {
  try {
    // The catalogue is public; the key is passed only when the server has one.
    const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || undefined });
    const res = await gateway.getAvailableModels();
    const map = new Map<string, string>();
    for (const m of res.models) {
      if (m.modelType && m.modelType !== 'language') continue;
      map.set(m.id, m.name || m.id);
    }
    return map;
  } catch (err) {
    const status = (err as { statusCode?: unknown })?.statusCode;
    console.error(`model catalogue request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`);
    return null;
  }
}

async function openrouterCatalogue(): Promise<Map<string, string> | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw Object.assign(new Error(), { statusCode: res.status });
    const body = (await res.json()) as { data?: { id?: unknown; name?: unknown }[] };
    const map = new Map<string, string>();
    for (const m of body.data ?? []) {
      if (typeof m.id !== 'string') continue;
      // OpenRouter names read "Vendor: Model"; the vendor is already obvious from the id.
      const name = typeof m.name === 'string' ? m.name.replace(/^[^:]+:\s*/, '') : m.id;
      map.set(m.id, name || m.id);
    }
    return map;
  } catch (err) {
    const status = (err as { statusCode?: unknown })?.statusCode;
    console.error(`openrouter catalogue request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`);
    return null;
  }
}

/** The models offered for a provider; the first one is the default. */
export async function listModels(provider: ProviderId = 'gateway'): Promise<ModelOption[]> {
  // Vendors' own model lists need the player's key, so their offer is fixed and checked by hand.
  if (isDirect(provider)) return DIRECT_MODELS[provider].map(({ id, label }) => ({ id, label }));
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const wanted = envList('MANAGER_MODELS').length ? envList('MANAGER_MODELS') : PREFERRED_MODELS;
  const live = provider === 'openrouter' ? await openrouterCatalogue() : await gatewayCatalogue();
  let list: ModelOption[];
  if (live) {
    list = wanted
      .filter((id) => live.has(providerModelId(provider, id)))
      .map((id) => ({ id, label: live.get(providerModelId(provider, id))! }));
    // MANAGER_MODELS is trusted even if the catalogue does not know an id; the preferred list is not.
    if (!list.length && envList('MANAGER_MODELS').length) list = wanted.map((id) => ({ id, label: id }));
  } else {
    list = wanted.map((id) => ({ id, label: id }));
  }
  if (live && list.length) cache.set(provider, { at: Date.now(), list });
  return list;
}

/** What free shifts run on unless FREE_MODELS says otherwise: cheap, and good enough to play against. */
export const FREE_DEFAULT_MODELS = ['deepseek/deepseek-v4.1-flash'];

/** The models a free shift may use: FREE_MODELS, or DeepSeek V4.1 Flash (the first model if the catalogue lacks it). */
export function freeModels(all: ModelOption[]): ModelOption[] {
  const env = envList('FREE_MODELS');
  const wanted = env.length ? env : FREE_DEFAULT_MODELS;
  const list = all.filter((m) => wanted.includes(m.id));
  return list.length || env.length ? list : all.slice(0, 1);
}
