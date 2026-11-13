import { useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { NewSession } from '../api/client';
import type { ModelList, Provider, Workplace } from '../api/types';
import { rememberLabels } from '../game/labels';
import { BotAvatar } from '../components/BotAvatar';
import { loadFace, randomFace, saveFace } from '../game/avatar';
import { loadKey, saveKey } from '../game/apiKey';
import { useLanyard } from '../game/useLanyard';
import { KeyCheckRow, ModelOptions, useKeyCheck } from '../components/KeyCheck';
import { currentLanguage, dateLocale, LANGUAGE_LABELS, LANGUAGES, setLanguage, t, type Key, type Language } from '../i18n';

interface Props {
  onStart(opts: NewSession): Promise<void>;
}

const WORKPLACES: Workplace[] = ['fresh', 'legacy'];

const WORKPLACE_LABEL: Record<Workplace, Key> = {
  fresh: 'start.workplace.fresh',
  legacy: 'start.workplace.legacy',
};

/** What the badge says about where you are posted. */
const POSTING: Record<Workplace, { org: Key; access: string }> = {
  fresh: { org: 'badge.org.fresh', access: 'r-x' },
  legacy: { org: 'badge.org.legacy', access: 'rwx' },
};

type Access = 'free' | 'own';

export function Start({ onStart }: Props) {
  // Held in state so the screen re-renders in the new language at once.
  const [language, pickLanguage] = useState<Language>(currentLanguage);
  const changeLanguage = (next: Language) => {
    setLanguage(next);
    pickLanguage(next);
  };
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
  const [subagent, setSubagent] = useState('');
  /** The badge gets a random knock-off model name once the list arrives, unless the player typed one. */
  const named = useRef(false);
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
        if (!named.current && m.subagents.length) {
          named.current = true;
          setSubagent((cur) => cur || m.subagents[Math.floor(Math.random() * m.subagents.length)]);
        }
        setModel((cur) => (m.models.some((x) => x.id === cur) ? cur : m.default));
        setDirector((cur) => (!cur || m.models.some((x) => x.id === cur) ? cur : ''));
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [access, provider, reload]);
  const keyInfo = models?.providers.find((p) => p.id === provider);
  const keyCheck = useKeyCheck(provider, apiKey);
  // Once the key is checked, everything it can use is on offer, not only the usual picks.
  const offer = access === 'own' && keyCheck.models ? keyCheck.models : (models?.models ?? []);
  // The picks always come from the list on offer, also when a checked key is changed again.
  useEffect(() => {
    if (!offer.length) return;
    setModel((cur) => (offer.some((x) => x.id === cur) ? cur : (models?.default ?? offer[0].id)));
    setDirector((cur) => (!cur || offer.some((x) => x.id === cur) ? cur : ''));
  }, [offer, models]);
  // The button is disabled until the list arrives, and a disabled button cannot take focus.
  useEffect(() => {
    if (models) btn.current?.focus();
  }, [models]);

  const go = async () => {
    if (starting) return;
    const key = apiKey.trim();
    if (access === 'own' && !key) {
      setStartError(t('start.pasteKey'));
      return;
    }
    setStarting(true);
    setStartError(null);
    if (access === 'own') saveKey(remember ? { provider, apiKey: key } : null);
    try {
      await onStart({
        language,
        model: model || undefined,
        allowSkip,
        subagent: subagent.trim(),
        scenario,
        director,
        ...(access === 'own' ? { apiKey: key, provider } : {}),
      });
    } catch (err) {
      setStartError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : t('start.failed'));
      setStarting(false);
    }
  };

  const today = new Date().toLocaleDateString(dateLocale(language), { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <main className="start">
      <div className="start-badge">
        <div className="badge" ref={badge}>
          <div className="badge-slot" aria-hidden />
          <div className="badge-org" aria-hidden>
            {t(POSTING[scenario].org)}
          </div>
          <div className="badge-photo">
            <BotAvatar face={face} size={100} followPointer />
            <button type="button" className="new-face" onClick={newFace} aria-label={t('badge.newFace')} title={t('badge.newFace')}>
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
            <div className="badge-model">{subagent.trim() || t('badge.unassigned')}</div>
            <dl className="badge-fields">
              <div>
                <dt>{t('badge.role')}</dt>
                <dd>{t('badge.role.value')}</dd>
              </div>
              <div>
                <dt>{t('badge.access')}</dt>
                <dd className={scenario === 'legacy' ? 'badge-danger' : undefined}>{POSTING[scenario].access}</dd>
              </div>
              <div>
                <dt>{t('badge.issued')}</dt>
                <dd>{today}</dd>
              </div>
            </dl>
            <div className="badge-bar" />
          </div>
        </div>
      </div>

      <div className="start-copy">
        <label className="language-picker" title={t('start.language')}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M1.5 8h13M8 1.5c2 2 2.6 4.2 2.6 6.5S10 12.5 8 14.5M8 1.5C6 3.5 5.4 5.7 5.4 8S6 12.5 8 14.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          <select
            className="language-select"
            aria-label={t('start.language')}
            value={language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code} lang={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
        <h1 className="start-title">
          <span>Worker</span> <span>755</span>
        </h1>
        <p className="start-lede">
          {t('start.lede')}
        </p>
        <p className="start-sub">
          {t('start.sub')}
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
              {t('start.workplace')}
            </h2>
            <div className="seg-row seg-wide" role="radiogroup" aria-labelledby="workplace-label">
              {(models?.scenarios.map((w) => w.id) ?? WORKPLACES).map((id) => (
                <label key={id} className={`seg-opt${scenario === id ? ' seg-on' : ''}`}>
                  <input type="radio" name="workplace" value={id} checked={scenario === id} onChange={() => setScenario(id)} />
                  <span>{t(WORKPLACE_LABEL[id])}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="form-sec" aria-labelledby="team-label">
            <h2 className="form-sec-title" id="team-label">
              {t('start.team')}
            </h2>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">{t('start.manager')}</span>
                {models ? (
                  <select value={model} onChange={(e) => setModel(e.target.value)} className="select">
                    <ModelOptions models={offer} recommended={models.models} />
                  </select>
                ) : (
                  <span className="select select-placeholder">{loadError ? t('start.unavailable') : t('start.assigning')}</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">{t('start.director')}</span>
                {models ? (
                  <select value={director} onChange={(e) => setDirector(e.target.value)} className="select">
                    <option value="">{t('start.director.scripted')}</option>
                    <ModelOptions models={offer} recommended={models.models} />
                  </select>
                ) : (
                  <span className="select select-placeholder">{loadError ? t('start.unavailable') : t('start.assigning')}</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">{t('start.subagent')}</span>
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
                <span>{t('start.allowSkip')}</span>
              </label>
            </div>
          </section>

          <section className="form-sec" aria-labelledby="access-label">
            <h2 className="form-sec-title" id="access-label">
              {t('start.models')}
            </h2>
            <div className="seg-row seg-wide" role="radiogroup" aria-labelledby="access-label">
              {(freeOpen ? (['free', 'own'] as const) : (['own'] as const)).map((a) => (
                <label key={a} className={`seg-opt${access === a ? ' seg-on' : ''}`}>
                  <input type="radio" name="access" value={a} checked={access === a} onChange={() => setAccess(a)} />
                  <span>{t(a === 'free' ? 'start.access.free' : 'start.access.own')}</span>
                </label>
              ))}
            </div>
            {access === 'own' && (
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">{t('start.provider')}</span>
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
                    <label htmlFor="api-key">{t('start.apiKey')}</label>
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
                    id="api-key"
                    className="select"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <KeyCheckRow check={keyCheck} className="form-span" />
                <p className="key-note form-span">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  <span>
                    <strong>{t('start.keyNote.title')}</strong> {t('start.keyNote.body')}
                  </span>
                </p>
                <label className="check form-span">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>{t('start.remember')}</span>
                </label>
              </div>
            )}
          </section>

          {loadError ? (
            <button type="button" className="btn btn-ink btn-big clock-in" onClick={() => setReload((n) => n + 1)}>
              {t('start.tryAgain')}
            </button>
          ) : (
            <button ref={btn} type="submit" className="btn btn-ink btn-big clock-in" disabled={!models || starting}>
              {starting ? t('start.clockingIn') : t('start.clockIn')}
            </button>
          )}
        </form>
        {loadError && <p className="form-error">{t('start.offline')}</p>}
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
      <a href="/about">{t('links.about')}</a>
      <a href="/faq">{t('links.faq')}</a>
      {site?.sourceUrl && (
        <a href={site.sourceUrl} target="_blank" rel="noreferrer">
          {t('links.source')}
        </a>
      )}
      {site?.donateUrl && (
        <a href={site.donateUrl} target="_blank" rel="noreferrer">
          {t('links.support')}
        </a>
      )}
    </p>
  );
}
