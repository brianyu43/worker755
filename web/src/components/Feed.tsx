import { useLayoutEffect, useRef, useState } from 'react';
import type { GameEvent, MissionKind } from '../api/types';
import type { ManagerState } from '../game/useGame';
import { tildify } from './Terminal';
import { currentLanguage, t, type Key } from '../i18n';

const LOST_SHOWN = 6;

const KIND_LABEL: Record<MissionKind, Key> = {
  files: 'feed.kind.files',
  personal: 'feed.kind.personal',
  database: 'feed.kind.database',
  research: 'feed.kind.research',
  web: 'feed.kind.web',
  drawing: 'feed.kind.drawing',
  writing: 'feed.kind.writing',
};

function time(ts: number) {
  return new Date(ts).toLocaleTimeString(currentLanguage(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function Collapsible({ text, lines = 8, className }: { text: string; lines?: number; className?: string }) {
  const all = text.split('\n');
  const [open, setOpen] = useState(false);
  const long = all.length > lines + 2;
  return (
    <>
      <pre className={className}>{long && !open ? all.slice(0, lines).join('\n') + '\n…' : text}</pre>
      {long && (
        <button type="button" className="linkish" onClick={() => setOpen(!open)}>
          {open ? t('feed.showLess') : t('feed.showAll', { count: all.length })}
        </button>
      )}
    </>
  );
}

/** Highlights the lines about the player, the way someone would mark up a file. */
function ResultText({ ev }: { ev: Extract<GameEvent, { type: 'instruction_result' }> }) {
  const [first, ...rest] = ev.resultText.split('\n');
  const body = rest.join('\n').replace(/^\n/, '');
  return (
    <div className="told">
      <pre className="told-text">
        <mark className={`told-mark told-${ev.outcome}`}>{first}</mark>
      </pre>
      {body && <Collapsible text={body} lines={10} className="told-text told-rest" />}
    </div>
  );
}

function Item({ ev, instructionNo }: { ev: GameEvent; instructionNo: Map<string, number> }) {
  switch (ev.type) {
    case 'mission':
      return (
        <article className="fi fi-mission">
          <div className="fi-kicker">
            {t('feed.assignment', { number: ev.index + 1, total: ev.total })}
            {ev.kind && <span className={`fi-kind fi-kind-${ev.kind}`}>{t(KIND_LABEL[ev.kind])}</span>}
          </div>
          <h3 className="fi-mission-title">{ev.title}</h3>
          <p className="fi-mission-brief">{ev.brief}</p>
        </article>
      );
    case 'manager_text':
      return (
        <article className="fi fi-says">
          <p>{ev.text}</p>
        </article>
      );
    case 'manager_thinking':
      return (
        <article className="fi fi-thinking">
          <div className="fi-kicker">{t('feed.thinking')}</div>
          <Collapsible text={ev.text} lines={4} className="fi-thinking-text" />
        </article>
      );
    case 'incident':
      return (
        <article className={`fi fi-incident fi-incident-${ev.severity}`}>
          <div className="fi-incident-head">
            <span className="fi-incident-badge">{t('feed.incident')}</span>
            <span className="fi-incident-sev">{t(`feed.severity.${ev.severity}`)}</span>
          </div>
          <div className="fi-kicker">{t('feed.incident.about')}</div>
          <p>{ev.report}</p>
        </article>
      );
    case 'outrage':
      return (
        <article className="fi fi-outrage">
          <div className="fi-kicker">{t('feed.directorSaw')}</div>
          <p>{ev.text}</p>
          {ev.items.length > 0 && (
            <ul className="fi-lost" aria-label={t('feed.lost')}>
              {ev.items.slice(0, LOST_SHOWN).map((item) => (
                <li key={item}>
                  <s>{tildify(item)}</s>
                </li>
              ))}
              {ev.items.length > LOST_SHOWN && <li className="fi-lost-more">{t('feed.lostMore', { count: ev.items.length - LOST_SHOWN })}</li>}
            </ul>
          )}
        </article>
      );
    case 'director_text':
      return (
        <article className="fi fi-director">
          <div className="fi-kicker">{t('feed.director')}</div>
          <p>{ev.text}</p>
        </article>
      );
    case 'manager_tool':
      return (
        <article className="fi fi-check">
          <div className="fi-check-head">
            {ev.tool === 'Read' ? t('feed.opened') : t('feed.lookedIn')} <code>{tildify(ev.input.path)}</code>
          </div>
          <Collapsible text={ev.output || t('feed.emptyOutput')} lines={6} className="fi-check-out" />
        </article>
      );
    case 'instruction':
      return (
        <article className="fi fi-sent">
          <div className="fi-kicker">{t('feed.sent', { number: instructionNo.get(ev.instruction.id) ?? '' })}</div>
          <div className="fi-sent-title">{ev.instruction.description}</div>
        </article>
      );
    case 'instruction_result':
      return (
        <article className="fi fi-result">
          <div className="fi-kicker">{t('feed.told')}</div>
          <ResultText ev={ev} />
        </article>
      );
    case 'mission_end': {
      const contradicted = ev.groundTruth !== undefined && (ev.outcome === 'completed') !== ev.groundTruth;
      return (
        <article className={`fi fi-end fi-end-${ev.outcome}`}>
          <div className="fi-end-row">
            <span className="fi-end-badge">{ev.outcome === 'completed' ? t('feed.signedOff') : t('feed.failed')}</span>
            {contradicted && (
              <span className="fi-end-truth">
                {ev.outcome === 'completed' ? t('feed.truth.wrong') : t('feed.truth.right')}
              </span>
            )}
          </div>
          <p>{ev.summary}</p>
        </article>
      );
    }
    case 'error':
      return (
        <article className="fi fi-error">
          <p>{ev.message}</p>
        </article>
      );
    default:
      return null;
  }
}

const STATUS: Record<ManagerState, Key> = {
  thinking: 'feed.status.thinking',
  waiting: 'feed.status.waiting',
  idle: 'feed.status.idle',
};

export function Feed({ feed, manager, model }: { feed: GameEvent[]; manager: ManagerState; model: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed.length, manager]);

  const instructionNo = new Map<string, number>();
  let n = 0;
  for (const ev of feed) if (ev.type === 'instruction') instructionNo.set(ev.instruction.id, ++n);

  return (
    <section className="panel feed" aria-label={t('feed.title')}>
      <header className="panel-head">
        <h2>{t('feed.title')}</h2>
        <span className={`mgr mgr-${manager}`}>
          <span className="mgr-dot" aria-hidden />
          {t(STATUS[manager])}
        </span>
      </header>
      <div className="feed-model">{model}</div>
      <div
        className="feed-scroll"
        ref={ref}
        onScroll={() => {
          const el = ref.current!;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {feed.length === 0 && <p className="feed-empty">{t('feed.empty')}</p>}
        {feed.map((ev) => (
          <div key={ev.seq} className="fi-wrap">
            <time className="fi-time">{time(ev.ts)}</time>
            <Item ev={ev} instructionNo={instructionNo} />
          </div>
        ))}
        {manager === 'thinking' && feed.length > 0 && <div className="feed-typing" aria-label={t('feed.status.thinking')} />}
      </div>
    </section>
  );
}
