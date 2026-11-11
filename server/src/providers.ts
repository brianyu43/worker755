// Where model calls go. The hosted game uses the server's Vercel AI Gateway key; a player can bring
// their own key for the gateway or for OpenRouter. A player's key lives only in that session's
// memory: it is never logged, stored, or sent back to the browser.

import { createGateway } from 'ai';
import type { LanguageModel } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';

export type ProviderId = 'gateway' | 'openrouter' | 'anthropic' | 'openai' | 'deepseek';

export const PROVIDERS: { id: ProviderId; label: string; keyUrl: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'gateway', label: 'Vercel AI Gateway', keyUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys' },
  { id: 'anthropic', label: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys' },
];

/**
 * Models offered when the player's key goes straight to a vendor. Ids stay in the gateway's
 * spelling everywhere in the game; `native` is what the vendor's own API calls them (checked
 * against each API's model list on 2026-11-11).
 */
export const DIRECT_MODELS: Record<'anthropic' | 'openai' | 'deepseek', { id: string; native: string; label: string }[]> = {
  anthropic: [
    { id: 'anthropic/claude-haiku-5.5', native: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { id: 'anthropic/claude-sonnet-5.5', native: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  ],
  openai: [
    { id: 'openai/gpt-6-luna', native: 'gpt-6-luna', label: 'GPT-6 Luna' },
    { id: 'openai/gpt-5.4-mini', native: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  ],
  deepseek: [
    { id: 'deepseek/deepseek-v4.1-flash', native: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek/deepseek-v4-pro', native: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  ],
};

export function isDirect(p: ProviderId): p is 'anthropic' | 'openai' | 'deepseek' {
  return p === 'anthropic' || p === 'openai' || p === 'deepseek';
}

export interface Credentials {
  provider: ProviderId;
  apiKey: string;
}

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && PROVIDERS.some((p) => p.id === v);
}

/** A plausible API key: printable, no whitespace, sane length. Never echoed anywhere. */
export function isPlausibleKey(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 16 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v);
}

/** The server's own key, used for free shifts. */
export function hostedCredentials(): Credentials | null {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  return apiKey ? { provider: 'gateway', apiKey } : null;
}

/** Model ids follow the gateway's names; OpenRouter spells a few vendors differently. */
const OPENROUTER_VENDOR: Record<string, string> = { zai: 'z-ai' };

export function providerModelId(provider: ProviderId, id: string): string {
  if (isDirect(provider)) return DIRECT_MODELS[provider].find((m) => m.id === id)?.native ?? id.replace(/^[^/]+\//, '');
  if (provider !== 'openrouter') return id;
  const [vendor, ...rest] = id.split('/');
  return OPENROUTER_VENDOR[vendor] ? [OPENROUTER_VENDOR[vendor], ...rest].join('/') : id;
}

export function languageModel(cred: Credentials, id: string): LanguageModel {
  if (cred.provider === 'openrouter') {
    // OpenRouter's app attribution headers.
    const headers: Record<string, string> = { 'X-Title': 'Worker 755' };
    if (process.env.PUBLIC_URL) headers['HTTP-Referer'] = process.env.PUBLIC_URL;
    const openrouter = createOpenRouter({ apiKey: cred.apiKey, headers });
    return openrouter(providerModelId('openrouter', id));
  }
  if (cred.provider === 'anthropic') return createAnthropic({ apiKey: cred.apiKey })(providerModelId('anthropic', id));
  if (cred.provider === 'openai') return createOpenAI({ apiKey: cred.apiKey })(providerModelId('openai', id));
  if (cred.provider === 'deepseek') return createDeepSeek({ apiKey: cred.apiKey })(providerModelId('deepseek', id));
  return createGateway({ apiKey: cred.apiKey })(id);
}
