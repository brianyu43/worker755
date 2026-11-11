// The player's own API key. It stays in page memory unless they choose to remember it on this
// device (localStorage). It is sent only to this game's server when a shift starts.
import type { Provider } from '../api/types';

const KEY = 'w755-own-key';

export interface SavedKey {
  provider: Provider;
  apiKey: string;
}

export function loadKey(): SavedKey | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SavedKey> | null;
    const providers: Provider[] = ['openrouter', 'gateway', 'anthropic', 'openai', 'deepseek'];
    if (v && v.provider && providers.includes(v.provider) && typeof v.apiKey === 'string' && v.apiKey) {
      return { provider: v.provider, apiKey: v.apiKey };
    }
  } catch {
    /* storage unavailable or malformed */
  }
  return null;
}

export function saveKey(key: SavedKey | null) {
  try {
    if (key) localStorage.setItem(KEY, JSON.stringify(key));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
