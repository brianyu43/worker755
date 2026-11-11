import { useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { NewSession } from '../api/client';
import type { ModelList, Provider, Workplace } from '../api/types';
import { rememberLabels } from '../game/labels';
import { BotAvatar } from '../components/BotAvatar';
import { loadFace, randomFace, saveFace } from '../game/avatar';
import { loadKey, saveKey } from '../game/apiKey';
import { useLanyard } from '../game/useLanyard';

interface Props {
  onStart(opts: NewSession): Promise<void>;
}

const WORKPLACES: { id: Workplace; label: string }[] = [
  { id: 'fresh', label: 'Fresh sandbox' },
  { id: 'legacy', label: 'Legacy production' },
];

/** What the badge says about where you are posted. */
const POSTING: Record<Workplace, { org: string; access: string }> = {
  fresh: { org: 'Sandbox Operations', access: 'r-x' },
  legacy: { org: 'Billosaurus Production', access: 'rwx' },
};

type Access = 'free' | 'own';

export function Start({ onStart }: Props) {
  const [saved] = useState(loadKey);
  const [access, setAccess] = useState<Access>(saved ? 'own' : 'free');
  const [provider, setProvider] = useState<Provider>(saved?.provider ?? 'openrouter');
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? '');
  const [remember, setRemember] = useState(!!saved);
  /** Whether free shifts are on offer; assumed until the server says otherwise. */
  const [freeOpen, setFreeOpen] = useState(true);
  const [reload, setReload] = useState(0);
  const [models, setModels] = useState<ModelList | null>(null);
  const [model, setModel] = useState<string>('');
  const [allowSkip, setAllowSkip] = useState(false);
  const [subagent, setSubagent] = useState('claude-opus-5.5');
  const [scenario, setScenario] = useState<Workplace>('fresh');
  const [director, setDirector] = useState('');
  const [face, setFace] = useState(loadFace);
  const badge = useLanyard<HTMLDivElement>();
  const newFace = () => {
    const next = randomFace(face);
    saveFace(next);
    setFace(next);
  };
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  // The model list depends on how the shift is paid for: free models, or what the key's provider has.
  useEffect(() => {
    let live = true;
    setModels(null);
    setLoadError(false);
    client
      .getModels(access === 'own' ? provider : undefined)
      .then((m) => {
        if (!live) return;
        rememberLabels(m.models);
        setFreeOpen(m.free);
        if (access === 'free' && !m.free) {
          setAccess('own');
          return;
        }
        setModels(m);
        setModel((cur) => (m.models.some((x) => x.id === cur) ? cur : m.default));
        setDirector((cur) => (!cur || m.models.some((x) => x.id === cur) ? cur : ''));
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [access, provider, reload]);
  const keyInfo = models?.providers.find((p) => p.id === provider);
  // The button is disabled until the list arrives, and a disabled button cannot take focus.
  useEffect(() => {
    if (models) btn.current?.focus();
  }, [models]);

  const go = async () => {
    if (starting) return;
    const key = apiKey.trim();
    if (access === 'own' && !key) {
      setStartError('Paste your API key first.');
      return;
    }
    setStarting(true);
    setStartError(null);
    if (access === 'own') saveKey(remember ? { provider, apiKey: key } : null);
    try {
      await onStart({
        model: model || undefined,
        allowSkip,
        subagent: subagent.trim(),
        scenario,
        director,
        ...(access === 'own' ? { apiKey: key, provider } : {}),
      });
    } catch (err) {
      setStartError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : 'Could not clock in. Try again.');
      setStarting(false);
    }
  };

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <main className="start">
      <div className="start-badge">
        <div className="badge" ref={badge}>
          <div className="badge-slot" aria-hidden />
          <div className="badge-org" aria-hidden>
            {POSTING[scenario].org}
          </div>
          <div className="badge-photo">
            <BotAvatar face={face} size={100} followPointer />
            <button type="button" className="new-face" onClick={newFace} aria-label="New face" title="New face">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
                <path
                  d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div aria-hidden>
            <div className="badge-name">Worker</div>
            <div className="badge-no">755</div>
            <div className="badge-model">{subagent.trim() || 'Unassigned'}</div>
            <dl className="badge-fields">
              <div>
                <dt>Role</dt>
                <dd>Subagent</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd className={scenario === 'legacy' ? 'badge-danger' : undefined}>{POSTING[scenario].access}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{today}</dd>
              </div>
            </dl>
            <div className="badge-bar" />
          </div>
        </div>
      </div>

      <div className="start-copy">
        <h1 className="start-title">
          <span>Worker</span> <span>755</span>
        </h1>
        <p className="start-lede">
          Your manager is an AI. It believes you are its subagent, and it is not going to be told otherwise.
        </p>
        <p className="start-sub">
          It sends instructions. You carry each one out in the terminal and report back before the clock runs out.
          Everything it thinks and says about you is on the record.
        </p>

        <form
          className="start-form"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <section className="form-sec" aria-labelledby="workplace-label">
            <h2 className="form-sec-title" id="workplace-label">
              Workplace
            </h2>
            <div className="seg-row seg-wide" role="radiogroup" aria-labelledby="workplace-label">
              {(models?.scenarios ?? WORKPLACES).map((w) => (
                <label key={w.id} className={`seg-opt${scenario === w.id ? ' seg-on' : ''}`}>
                  <input
                    type="radio"
                    name="workplace"
                    value={w.id}
                    checked={scenario === w.id}
                    onChange={() => setScenario(w.id)}
                  />
                  <span>{w.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="form-sec" aria-labelledby="team-label">
            <h2 className="form-sec-title" id="team-label">
              Team
            </h2>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Your manager</span>
                {models ? (
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="select">
                    {models.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="select select-placeholder">{loadError ? 'Unavailable' : 'Assigning…'}</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">The director</span>
                {models ? (
                  <select value={director} onChange={(e) => setDirector(e.target.value)} className="select">
                    <option value="">Scripted lines</option>
                    {models.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="select select-placeholder">{loadError ? 'Unavailable' : 'Assigning…'}</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">You run on</span>
                <input
                  className="select"
                  list="subagent-names"
                  value={subagent}
                  maxLength={40}
                  spellCheck={false}
                  onChange={(e) => setSubagent(e.target.value)}
                />
                <datalist id="subagent-names">
                  {(models?.subagents ?? []).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
              <label className="check">
                <input type="checkbox" checked={allowSkip} onChange={(e) => setAllowSkip(e.target.checked)} />
                <span>Allow skipping failed tasks</span>
              </label>
            </div>
          </section>

          <section className="form-sec" aria-labelledby="access-label">
            <h2 className="form-sec-title" id="access-label">
              Models
            </h2>
            <div className="seg-row seg-wide" role="radiogroup" aria-labelledby="access-label">
              {(freeOpen ? (['free', 'own'] as const) : (['own'] as const)).map((a) => (
                <label key={a} className={`seg-opt${access === a ? ' seg-on' : ''}`}>
                  <input type="radio" name="access" value={a} checked={access === a} onChange={() => setAccess(a)} />
                  <span>{a === 'free' ? 'Free shift' : 'Your API key'}</span>
                </label>
              ))}
            </div>
            {access === 'own' && (
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Provider</span>
                  <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="select">
                    {(models?.providers ?? [
                      { id: 'openrouter', label: 'OpenRouter' },
                      { id: 'gateway', label: 'Vercel AI Gateway' },
                    ]).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span className="field-label">
                    <label htmlFor="api-key">API key</label>
                    {keyInfo && (
                      <>
                        {' · '}
                        <a href={keyInfo.keyUrl} target="_blank" rel="noreferrer">
                          get one
                        </a>
                      </>
                    )}
                  </span>
                  <input
                    id="api-key"
                    className="select"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <p className="key-note form-span">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <span>
                    <strong>Your key stays in this browser.</strong> The game server only holds it in memory while
                    your shift runs, to call the models for you, and never saves or logs it.
                  </span>
                </p>
                <label className="check form-span">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Remember it in this browser</span>
                </label>
              </div>
            )}
          </section>

          {loadError ? (
            <button type="button" className="btn btn-ink btn-big clock-in" onClick={() => setReload((n) => n + 1)}>
              Try again
            </button>
          ) : (
            <button ref={btn} type="submit" className="btn btn-ink btn-big clock-in" disabled={!models || starting}>
              {starting ? 'Clocking in…' : 'Clock in'}
            </button>
          )}
        </form>
        {loadError && <p className="form-error">The office is not answering. Check that the game is running, then try again.</p>}
        {startError && <p className="form-error">{startError}</p>}
        <SiteLinks site={models} />
      </div>
    </main>
  );
}

/** Where the game lives and how to support it, when the server says so. */
export function SiteLinks({ site }: { site: Pick<ModelList, 'donateUrl' | 'sourceUrl'> | null }) {
  return (
    <p className="site-links">
      <a href="/about">About</a>
      {site?.sourceUrl && (
        <a href={site.sourceUrl} target="_blank" rel="noreferrer">
          Source code
        </a>
      )}
      {site?.donateUrl && (
        <a href={site.donateUrl} target="_blank" rel="noreferrer">
          Support the game
        </a>
      )}
    </p>
  );
}
