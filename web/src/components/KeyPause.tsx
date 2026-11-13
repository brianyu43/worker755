import { useEffect, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { ModelList, PauseReason, Provider } from '../api/types';
import { loadKey, saveKey } from '../game/apiKey';
import { rememberLabels } from '../game/labels';
import { t } from '../i18n';

interface Props {
  sessionId: string;
  reason: PauseReason;
  /** The manager's model so far; kept when the key's provider offers it. */
  model: string;
}

/**
 * The shift is waiting: the free shift is used up, or the player's key stopped working. They can add a
 * key and go on from where it stopped, or end the shift and get the review.
 */
export function KeyPause({ sessionId, reason, model: current }: Props) {
  const saved = loadKey();
  const [provider, setProvider] = useState<Provider>(saved?.provider ?? 'openrouter');
  const [apiKey, setApiKey] = useState(reason === 'allowance' ? (saved?.apiKey ?? '') : '');
  const [remember, setRemember] = useState(!!saved);
  const [models, setModels] = useState<ModelList | null>(null);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<'continue' | 'finish' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setModels(null);
    client
      .getModels(provider)
      .then((m) => {
        if (!live) return;
        rememberLabels(m.models);
        setModels(m);
        setModel((cur) => [cur, current].find((id) => m.models.some((x) => x.id === id)) ?? m.default);
      })
      .catch(() => live && setError(t('start.offline')));
    return () => {
      live = false;
    };
  }, [provider, current]);
  const keyInfo = models?.providers.find((p) => p.id === provider);

  const fail = (err: unknown) => {
    setError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : t('pause.failed'));
    setBusy(null);
  };

  const go = async () => {
    if (busy) return;
    const key = apiKey.trim();
    if (!key) {
      setError(t('start.pasteKey'));
      return;
    }
    setBusy('continue');
    setError(null);
    try {
      await client.continueShift(sessionId, { provider, apiKey: key, model });
      saveKey(remember ? { provider, apiKey: key } : null);
    } catch (err) {
      fail(err);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy('finish');
    setError(null);
    try {
      await client.finishShift(sessionId);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <section className="pause" aria-labelledby="pause-title">
      <div className="pause-kicker">
        <span className="order-no">{t('pause.kicker')}</span>
      </div>
      <h2 className="pause-title" id="pause-title">
        {t(reason === 'allowance' ? 'pause.allowance.title' : reason === 'key' ? 'pause.key.title' : 'pause.credit.title')}
      </h2>
      <p className="pause-text">{t(reason === 'allowance' ? 'pause.allowance.body' : 'pause.key.body')}</p>
      <form
        className="pause-form"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <label className="field">
          <span className="field-label">{t('start.provider')}</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="select">
            {(models?.providers ?? [{ id: provider, label: provider }]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('start.manager')}</span>
          {models ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className="select">
              {models.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="select select-placeholder">{t('start.assigning')}</span>
          )}
        </label>
        <div className="field pause-key">
          <span className="field-label">
            <label htmlFor="pause-key">{t('start.apiKey')}</label>
            {keyInfo && (
              <>
                {' · '}
                <a href={keyInfo.keyUrl} target="_blank" rel="noreferrer">
                  {t('start.getKey')}
                </a>
              </>
            )}
          </span>
          <input
            id="pause-key"
            className="select"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoFocus
          />
        </div>
        <label className="check pause-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t('start.remember')}</span>
        </label>
        <div className="pause-actions">
          <button type="submit" className="btn btn-ink" disabled={!models || busy !== null}>
            {busy === 'continue' ? t('pause.continuing') : t('pause.continue')}
          </button>
          <button type="button" className="btn" onClick={() => void finish()} disabled={busy !== null}>
            {busy === 'finish' ? t('pause.ending') : t('pause.finish')}
          </button>
        </div>
        {error && <p className="form-error pause-error">{error}</p>}
      </form>
    </section>
  );
}
