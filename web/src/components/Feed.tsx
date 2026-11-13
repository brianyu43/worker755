import { modelLabel } from '../game/labels';
import { useLayoutEffect, useState } from 'react';
import type { GameEvent, MissionKind, OpenInstruction } from '../api/types';
import type { ManagerState } from '../game/useGame';
import { tildify } from './Terminal';
import { useStickToBottom } from './stick';
import { Markdown } from './Markdown';
import { formatClock, useTicker } from './WorkOrder';
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

/** Long text folded to its first lines; `md` renders it as Markdown instead of as it was typed. */
function Collapsible({ text, lines = 8, className, md }: { text: string; lines?: number; className?: string; md?: boolean }) {
  const all = text.split('\n');
  const [open, setOpen] = useState(false);
  const long = all.length > lines + 2;
  const shown = long && !open ? all.slice(0, lines).join('\n') + '\n…' : text;
  return (
    <>
      {md ? <Markdown text={shown} className={className} /> : <pre className={className}>{shown}</pre>}
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

const SEVERITY_RANK = { minor: 1, major: 2, critical: 3 } as const;

export function Eye({ size = 15 }: { size?: number }) {
  return (
    <svg className="eye" viewBox="0 0 24 14" width={size} height={(size * 14) / 24} aria-hidden>
      <path d="M1 7C4 2.5 8 1 12 1s8 1.5 11 6c-3 4.5-7 6-11 6S4 11.5 1 7z" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="7" r="3.3" fill="currentColor" />
    </svg>
  );
}

/** The manager's reasoning, folded away except for the newest. */
function Thinking({ text, latest }: { text: string; latest: boolean }) {
  const [open, setOpen] = useState(latest);
  return (
    <details className="fi fi-thinking" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="fi-thinking-sum">{t('feed.thinking')}</summary>
      <Collapsible text={text} lines={4} className="fi-thinking-text" md />
    </details>
  );
}

function Item({ ev, instructionNo, latestThought }: { ev: GameEvent; instructionNo: Map<string, number>; latestThought: boolean }) {
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
          <div className="fi-label">{t('feed.manager')}</div>
          <Markdown text={ev.text} />
        </article>
      );
    case 'manager_thinking':
      return <Thinking text={ev.text} latest={latestThought} />;
    case 'incident':
      return (
        <article className={`fi fi-incident fi-incident-${ev.severity}`}>
          <div className="fi-incident-head">
            <span className="fi-incident-badge">{t('feed.incident')}</span>
            <span className="fi-incident-sev">
              <span className="fi-incident-scale" aria-hidden>
                {[1, 2, 3].map((n) => (
                  <i key={n} className={n <= SEVERITY_RANK[ev.severity] ? 'on' : ''} />
                ))}
              </span>
              <em>{t(`feed.severity.${ev.severity}`)}</em>
            </span>
          </div>
          <Markdown text={ev.report} className="fi-incident-body" />
          <div className="fi-incident-foot">{t('feed.incident.about')}</div>
        </article>
      );
    case 'outrage':
      return (
        <article className="fi fi-outrage">
          <div className="fi-label">
            <Eye /> {t('feed.directorSaw')}
          </div>
          <Markdown text={ev.text} />
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
          <div className="fi-label">
            <Eye /> {t('feed.director')}
          </div>
          <Markdown text={ev.text} />
        </article>
      );
    case 'manager_tool':
      return (
        <article className="fi fi-check">
          <div className="fi-check-head">
            <span className="fi-check-tag">{ev.tool === 'Read' ? t('feed.opened') : t('feed.lookedIn')}</span>
            <code>{tildify(ev.input.path)}</code>
          </div>
          <Collapsible text={ev.output || t('feed.emptyOutput')} lines={6} className="fi-check-out" />
        </article>
      );
    case 'instruction':
      return (
        <article className="fi fi-sent">
          <div className="fi-kicker">{t('feed.sent', { number: instructionNo.get(ev.instruction.id) ?? '' })}</div>
          <div className="fi-sent-title">{ev.instruction.description} →</div>
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
          <Markdown text={ev.summary} />
        </article>
      );
    }
    case 'error':
      return (
        <article className="fi fi-error">
          <p>{ev.message}</p>
        </article>
      );
    case 'resumed':
      return (
        <article className="fi fi-resumed">
          <div className="fi-kicker">{t('feed.resumed')}</div>
          <div className="fi-resumed-model">{modelLabel(ev.model)}</div>
        </article>
      );
    default:
      return null;
  }
}

/** What the manager is doing: waiting for the player, thinking, or reading the player's files. */
export type ManagerPhase = 'waiting' | 'thinking' | 'checking' | 'idle';

export function managerPhase(feed: GameEvent[], manager: ManagerState): ManagerPhase {
  if (manager !== 'thinking') return manager;
  for (let i = feed.length - 1; i >= 0; i--) {
    const type = feed[i].type;
    if (type === 'manager_thinking' || type === 'manager_text') continue;
    return type === 'manager_tool' ? 'checking' : 'thinking';
  }
  return 'thinking';
}

const PHASES: [Exclude<ManagerPhase, 'idle'>, Key][] = [
  ['waiting', 'feed.status.waiting'],
  ['thinking', 'feed.status.thinking'],
  ['checking', 'feed.status.checking'],
];

export const PHASE_LABEL: Record<ManagerPhase, Key> = {
  waiting: 'feed.status.waiting',
  thinking: 'feed.status.thinking',
  checking: 'feed.status.checking',
  idle: 'feed.status.idle',
};

interface FeedProps {
  feed: GameEvent[];
  manager: ManagerState;
  model: string;
  instruction: OpenInstruction | null;
  serverNow(): number;
}

export function Feed({ feed, manager, model, instruction, serverNow }: FeedProps) {
  const { ref, stick, onScroll } = useStickToBottom<HTMLDivElement>(40);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed.length, manager]);
  const phase = managerPhase(feed, manager);
  useTicker(phase === 'waiting' && instruction !== null, 1000);

  const instructionNo = new Map<string, number>();
  let n = 0;
  let lastThought = -1;
  for (const ev of feed) {
    if (ev.type === 'instruction') instructionNo.set(ev.instruction.id, ++n);
    if (ev.type === 'manager_thinking') lastThought = ev.seq;
  }

  return (
    <section className="panel feed" aria-label={t('feed.title')}>
      <header className="feed-head">
        <div className="feed-head-top">
          <h2>{t('feed.title')}</h2>
          <small className="panel-sub">{model}</small>
        </div>
        <div className="feed-phases" role="status" aria-label={t(PHASE_LABEL[phase])}>
          {PHASES.map(([key, label]) => (
            <span key={key} className={`feed-phase${phase === key ? ' feed-phase-on' : ''}`} aria-hidden>
              <i />
              {t(label)}
            </span>
          ))}
        </div>
      </header>
      <div
        className="feed-scroll"
        ref={ref}
        onScroll={onScroll}
        aria-live="polite"
      >
        {feed.length === 0 && <p className="feed-empty">{t('feed.empty')}</p>}
        {feed.map((ev) => (
          <div key={ev.seq} className="fi-wrap">
            <time className="fi-time">{time(ev.ts)}</time>
            <Item ev={ev} instructionNo={instructionNo} latestThought={ev.seq === lastThought} />
          </div>
        ))}
      </div>
      {phase !== 'idle' && (
        <div className={`feed-foot feed-foot-${phase}`}>
          <span className="feed-typing" aria-hidden />
          <span className="feed-foot-text">
            {phase === 'waiting' ? t('feed.foot.waiting') : t(PHASE_LABEL[phase])}
          </span>
          {phase === 'waiting' && instruction && (
            <span className="feed-foot-since">
              {t('feed.foot.since', { time: formatClock(Math.max(0, serverNow() - instruction.issuedAt)) })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
