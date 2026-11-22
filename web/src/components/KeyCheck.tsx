import { useState } from 'react';
import { ApiError, client } from '../api/client';
import type { Provider } from '../api/types';
import { rememberLabels } from '../game/labels';
import { currentLanguage, t } from '../i18n';

type Model = { id: string; label: string };

interface Checked {
  status: 'idle' | 'checking' | 'ok' | 'error';
  models?: Model[];
  error?: string;
  /** The provider and key the result belongs to; a result for another key no longer applies. */
  for?: string;
}

/**
 * Checks a player's key with its provider; once it answers, every model the key can use is on offer.
 * A provider that needs no key (a local model server) is asked for its models all the same.
 */
export function useKeyCheck(provider: Provider, apiKey: string, needsKey = true) {
  const [state, setState] = useState<Checked>({ status: 'idle' });
  const key = needsKey ? apiKey.trim() : '';
  const sig = `${provider}\n${key}`;
  const current: Checked = state.for === sig ? state : { status: 'idle' };

  const check = async () => {
    if (needsKey && !key) {
      setState({ status: 'error', error: t('start.pasteKey'), for: sig });
      return;
    }
    setState({ status: 'checking', for: sig });
    try {
      const res = await client.checkKey({ provider, apiKey: key, language: currentLanguage() });
      rememberLabels(res.models);
      setState({ status: 'ok', models: res.models, for: sig });
    } catch (err) {
      const error = err instanceof ApiError && err.status >= 400 && err.status < 600 && err.status !== 500 ? err.message : t('key.failed');
      setState({ status: 'error', error, for: sig });
    }
  };

  return { ...current, check, needsKey };
}

export type KeyCheck = ReturnType<typeof useKeyCheck>;

/** The "Check key" button and what the provider said, for under the key field. */
export function KeyCheckRow({ check, className }: { check: KeyCheck; className?: string }) {
  return (
    <div className={`key-check${className ? ` ${className}` : ''}`}>
      <button type="button" className="btn btn-small" onClick={() => void check.check()} disabled={check.status === 'checking'}>
        {check.status === 'checking' ? t('key.checking') : t(check.needsKey ? 'key.check' : 'key.checkLocal')}
      </button>
      <span className={`key-status${check.status === 'ok' ? ' key-ok' : check.status === 'error' ? ' key-bad' : ''}`} aria-live="polite">
        {check.status === 'ok' && t(check.needsKey ? 'key.ok' : 'key.okLocal', { count: check.models?.length ?? 0 })}
        {check.status === 'error' && check.error}
      </span>
    </div>
  );
}

/**
 * Options for a model picker. A short list stays flat; a provider's full list puts the game's usual
 * picks first, then every vendor in its own group.
 */
export function ModelOptions({ models, recommended }: { models: Model[]; recommended?: Model[] }) {
  if (models.length <= 12) {
    return (
      <>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </>
    );
  }
  const picks = new Set((recommended ?? []).map((m) => m.id));
  const top = models.filter((m) => picks.has(m.id));
  const byVendor = new Map<string, Model[]>();
  for (const m of models) {
    if (picks.has(m.id)) continue;
    const vendor = m.id.includes('/') ? m.id.slice(0, m.id.indexOf('/')) : '';
    byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), m]);
  }
  const vendors = [...byVendor.keys()].sort((a, b) => a.localeCompare(b));
  return (
    <>
      {top.length > 0 && (
        <optgroup label={t('key.recommended')}>
          {top.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      )}
      {vendors.map((v) => (
        <optgroup key={v} label={v || t('key.other')}>
          {byVendor.get(v)!.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
