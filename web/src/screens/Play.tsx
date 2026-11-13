import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import { Eye, Feed, PHASE_LABEL, activityOf, managerPhase } from '../components/Feed';
import { FileTree, StatsPanel } from '../components/Side';
import { Terminal, type TerminalHandle } from '../components/Terminal';
import { WorkOrder, formatClock, remainingOf, urgencyOf, useTicker } from '../components/WorkOrder';
import { MOD, touchOnly } from '../game/keys';
import { modelLabel } from '../game/labels';
import { HeaderFace } from '../components/HeaderFace';
import { Splitter, deskSizes } from '../components/Splitter';
import { KeyPause } from '../components/KeyPause';
import { EndShift } from '../components/EndShift';
import { Working } from '../components/Working';
import { loadFace } from '../game/avatar';
import type { GameEvent } from '../api/types';
import type { Game, GameView } from '../game/useGame';
import { t } from '../i18n';

type Tab = 'files' | 'work' | 'manager' | 'record';

/** Feed entries worth a badge on the phone's Manager tab. */
const NOTABLE = new Set<GameEvent['type']>([
  'mission',
  'manager_text',
  'director_text',
  'outrage',
  'incident',
  'instruction_result',
  'mission_end',
]);

function shiftClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** One mark per assignment: signed off, failed, the current one, or still to come. */
function Pips({ view, className }: { view: GameView; className: string }) {
  const ends = new Map<number, 'completed' | 'failed'>();
  for (const ev of view.feed) if (ev.type === 'mission_end') ends.set(ev.index, ev.outcome);
  return (
    <span
      className={className}
      role="img"
      aria-label={t('play.progress', { number: view.missionIndex + 1, total: view.missionTotal })}
    >
      {Array.from({ length: view.missionTotal }, (_, i) => {
        const end = ends.get(i);
        const state = end ?? (i === view.missionIndex && view.mission && view.status === 'running' ? 'current' : '');
        return <i key={i} className={state ? `pip-${state}` : undefined} />;
      })}
    </span>
  );
}

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  files: <path d="M2.5 5h5.5l2 2h7.5v9.5h-15z" />,
  work: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M5.5 8l2.5 2-2.5 2M10 12.5h4" />
    </>
  ),
  manager: <path d="M3 4h14v9.5H8.5L5 16.5v-3H3z" />,
  record: <path d="M4.5 15.5V10M10 15.5V4.5M15.5 15.5v-7M3 17.5h14" />,
};

interface Props {
  game: Game;
  view: GameView;
  onFinish(): void;
}


export function Play({ game, view, onFinish }: Props) {
  const term = useRef<TerminalHandle>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [reporting, setReporting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [face] = useState(loadFace);
  const [deskStyle] = useState(deskSizes);
  const [pleased, setPleased] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  // Phone layout: which screen is showing. Wide screens show everything and ignore it.
  const [tab, setTab] = useState<Tab>('work');
  const lastSeq = view.feed.length ? view.feed[view.feed.length - 1].seq : 0;
  let lastManagerSeq = 0;
  for (const e of view.feed) if (e.type === 'manager_text' || e.type === 'instruction') lastManagerSeq = e.seq;
  const [seenSeq, setSeenSeq] = useState(lastSeq);
  const [seenIncidents, setSeenIncidents] = useState(view.stats.incidents);
  const open = view.instruction;
  const instructionCount = view.feed.filter((e) => e.type === 'instruction').length;

  useTicker(true, open ? 250 : 1000);
  useEffect(() => {
    if (tab === 'manager') setSeenSeq(lastSeq);
    if (tab === 'record') setSeenIncidents(view.stats.incidents);
  }, [tab, lastSeq, view.stats.incidents]);
  useEffect(() => {
    if (tab === 'work' && !touchOnly()) term.current?.focus();
  }, [tab]);
  const unread = view.feed.filter((e) => e.seq > seenSeq && NOTABLE.has(e.type)).length;
  const newIncidents = Math.max(0, view.stats.incidents - seenIncidents);
  const phase = managerPhase(view.feed, view.manager);
  const lastWord = [...view.feed].reverse().find((e) => e.type === 'manager_text' || e.type === 'director_text');
  const shiftStart = view.feed[0]?.ts;
  const remaining = open ? remainingOf(open, game.serverNow()) : 0;
  const urgency = open ? urgencyOf(remaining, open.durationMs) : null;

  // Tab title carries the clock, so it is still there when the tab is in the background.
  useEffect(() => {
    document.title = open ? `${formatClock(remaining)} · Worker 755` : 'Worker 755';
  });
  useEffect(() => () => void (document.title = 'Worker 755'), []);

  // Narrate arrivals and outcomes in the terminal, where the player's eyes are.
  useEffect(
    () =>
      game.onEvent((ev) => {
        if (ev.type === 'instruction') {
          term.current?.print(t('play.newInstruction', { description: ev.instruction.description }), 'warn');
          setFlash('arrive');
        } else if (ev.type === 'outrage') {
          term.current?.print(t('play.directorSaw'), 'err');
          setFlash('outrage');
        } else if (ev.type === 'instruction_result') {
          const text =
            ev.outcome === 'reported'
              ? t('play.delivered')
              : ev.outcome === 'timeout_idle'
                ? t('play.timeUp.idle')
                : t('play.timeUp.partial');
          term.current?.print(text, ev.outcome === 'reported' ? 'ok' : 'err');
          setFlash(ev.outcome === 'reported' ? null : 'expire');
          if (ev.outcome === 'reported') setPleased(true);
        }
      }),
    [game],
  );
  useEffect(() => {
    if (!pleased) return;
    const timer = setTimeout(() => setPleased(false), 2500);
    return () => clearTimeout(timer);
  }, [pleased]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash === 'outrage' ? 1400 : 900);
    return () => clearTimeout(timer);
  }, [flash]);

  const report = useCallback(
    async (message: string) => {
      if (reporting) return;
      setReporting(true);
      try {
        await client.report(view.id, message.trim() || undefined);
        setNote('');
      } catch (e) {
        term.current?.print(
          e instanceof ApiError && e.status === 409 ? t('play.nothingToReport') : t('play.notDelivered'),
          'err',
        );
      } finally {
        setReporting(false);
        if (!touchOnly()) term.current?.focus();
      }
    },
    [reporting, view.id],
  );

  // Keyboard: Ctrl/Cmd+Enter reports from anywhere; stray typing lands in the terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tm = term.current;
      if (!tm) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (tm.isEditing()) return;
        e.preventDefault();
        void report(noteRef.current?.value ?? '');
        return;
      }
      const el = document.activeElement;
      const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'ArrowUp' || e.key === 'Enter')) {
        if (el instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
        tm.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report]);

  // Coming back to the tab puts the cursor back in the terminal.
  useEffect(() => {
    const onFocus = () => {
      if (document.activeElement === document.body && !touchOnly()) term.current?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const finished = view.status === 'finished';
  const cutShort = view.status === 'error';
  const canEnd = view.status === 'running' && !view.ending;
  const askEnd = () => setConfirmEnd(true);
  // On a phone the review notice and its button are on the Work tab: go there once the shift ends,
  // whichever tab the player ended it from.
  const over = view.ending || finished || cutShort;
  useEffect(() => {
    if (over) setTab('work');
  }, [over]);
  const title = open?.description ?? view.mission?.title ?? t('play.waiting');
  const tabs: [Tab, string, number][] = [
    ['files', t('files.title'), 0],
    ['work', t('play.tab.work'), 0],
    ['manager', t('play.tab.manager'), unread],
    ['record', t('play.tab.record'), newIncidents],
  ];

  return (
    <div className={`play play-tab-${tab}${view.paused ? ' play-paused' : ''}${urgency ? ` play-${urgency}` : ''}${flash ? ` play-flash-${flash}` : ''}`}>
      <header className="bar">
        <div className="bar-id">
          {canEnd ? (
            <button type="button" className="bar-badge bar-badge-btn" onClick={askEnd} title={t('end.button')} aria-label={t('end.button')}>
              755
            </button>
          ) : (
            <span className="bar-badge">755</span>
          )}
          <HeaderFace
            face={face}
            mood={pleased ? 'happy' : open ? 'thinking' : 'idle'}
            commands={view.stats.commands}
            commandErrors={view.stats.commandErrors}
            reports={view.stats.reports}
            incidents={view.stats.incidents}
            managerSeq={lastManagerSeq}
          />
          <span className="bar-who">
            <b className="bar-name">Worker 755</b>
            <span className="bar-role">{t('badge.role.value')}</span>
          </span>
        </div>
        {view.missionTotal > 0 && (
          <div className="bar-progress">
            <span className="bar-step">
              {view.missionIndex + 1}
              <i>/{view.missionTotal}</i>
            </span>
            <Pips view={view} className="pips" />
          </div>
        )}
        <div className="bar-now">
          {view.mission ? (
            <>
              <span className="bar-now-label">{t('play.now')}</span>
              <span className="bar-title">{view.mission.title}</span>
            </>
          ) : (
            <span className="bar-title">{t('play.waiting')}</span>
          )}
        </div>
        <div className="bar-task">
          <span className="bar-task-sub">
            {view.missionTotal > 0 && `${view.missionIndex + 1}/${view.missionTotal}`}
            {instructionCount > 0 && ` · ${t('order.number', { number: instructionCount })}`}
          </span>
          <span className="bar-task-title">{title}</span>
        </div>
        {!game.connected && <span className="bar-offline">{t('play.reconnecting')}</span>}
        {view.status === 'running' && (
          <div className="bar-watch">
            <span className="bar-live">{t('play.live')}</span>
            <Eye size={18} />
            <span className="bar-watch-text">{t('play.watching')}</span>
          </div>
        )}
        {shiftStart !== undefined && view.status === 'running' && (
          <div className="bar-shift">{t('play.shift', { time: shiftClock(game.serverNow() - shiftStart) })}</div>
        )}
        {open && (
          <div className={`bar-clock bar-clock-${urgency}`} aria-hidden>
            <small>{t('play.left')}</small>
            {formatClock(remaining)}
          </div>
        )}
      </header>
      {view.missionTotal > 0 && <Pips view={view} className="bar-pips" />}

      <div className="desk" style={deskStyle}>
        <aside className="desk-left">
          <FileTree tree={view.tree} cwd={view.cwd} editing={editingPath} lost={view.stats.damaged ?? 0} />
          <StatsPanel stats={view.stats} onEnd={canEnd ? askEnd : undefined} />
          <Splitter kind="left" />
        </aside>
        <div className="desk-main">
          {finished ? (
            <section className="order order-empty shift-over">
              <div className="order-empty-text">{t('play.over')}</div>
              <button type="button" className="btn btn-ink btn-big" onClick={onFinish} autoFocus>
                {t('play.readIt')}
              </button>
            </section>
          ) : cutShort ? (
            <section className="order order-empty shift-over">
              <div className="order-empty-text">{view.error ?? t('play.endedEarly')}</div>
              <button type="button" className="btn btn-ink btn-big" onClick={game.leave} autoFocus>
                {t('app.clockInAgain')}
              </button>
            </section>
          ) : view.ending ? (
            <section className="order order-empty shift-over" aria-live="polite">
              <div className="order-empty-text">{t('end.writing')}</div>
              <Working activity="reviewing" className="order-working" />
            </section>
          ) : view.paused ? (
            <KeyPause sessionId={view.id} reason={view.paused} model={view.model} />
          ) : (
            <WorkOrder
              instruction={view.instruction}
              closed={view.closed}
              manager={view.manager}
              serverNow={game.serverNow}
              count={instructionCount}
              activity={activityOf(managerPhase(view.feed, view.manager), instructionCount, false)}
              mission={view.mission ? { index: view.missionIndex, total: view.missionTotal, kind: view.mission.kind } : null}
            />
          )}
          <Splitter kind="order" />
          <button type="button" className={`peek peek-${phase}`} onClick={() => setTab('manager')}>
            <span className="peek-text">
              <span className="peek-who">
                {t('feed.manager')}
                {phase !== 'idle' && (
                  <span className="peek-state">
                    <i aria-hidden />
                    {t(PHASE_LABEL[phase])}
                  </span>
                )}
              </span>
              {lastWord && (
                <span className={`peek-line${lastWord.type === 'director_text' ? ' peek-director' : ''}`}>
                  {lastWord.type === 'director_text' && <Eye size={13} />} {'text' in lastWord ? lastWord.text : ''}
                </span>
              )}
            </span>
            {unread > 0 && <span className="peek-count">{unread}</span>}
            <span className="peek-chevron" aria-hidden>
              ›
            </span>
          </button>
          <Terminal
            ref={term}
            sessionId={view.id}
            cwd={view.cwd}
            tree={view.tree}
            onReport={report}
            onEditingChange={setEditingPath}
          />
          <form
            className={`report${open ? ' report-open' : ''}`}
            onSubmit={(e) => {
              e.preventDefault();
              void report(note);
            }}
          >
            <label className="report-field">
              <span className="report-pen" aria-hidden>
                ✎
              </span>
              <input
                ref={noteRef}
                className="report-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    term.current?.focus();
                  }
                }}
                placeholder={t('play.note')}
                aria-label={t('play.note.label')}
                maxLength={500}
              />
              <small className="report-hint">{t('play.note.hint')}</small>
            </label>
            <button type="submit" className="btn btn-report" disabled={!open || reporting}>
              {t('play.report')} <kbd>{MOD} ↵</kbd>
            </button>
          </form>
        </div>
        <aside className="desk-side">
          <Splitter kind="side" />
          <Feed
            feed={view.feed}
            manager={view.manager}
            model={modelLabel(view.model)}
            instruction={view.instruction}
            serverNow={game.serverNow}
            ending={view.ending}
          />
        </aside>
      </div>

      <EndShift sessionId={view.id} open={confirmEnd && canEnd} onClose={() => setConfirmEnd(false)} />

      <nav className="tabbar" aria-label={t('play.tabs')}>
        {tabs.map(([key, label, badge]) => (
          <button
            key={key}
            type="button"
            className={`tabbar-tab${tab === key ? ' tabbar-on' : ''}`}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {TAB_ICONS[key]}
            </svg>
            <span className="tabbar-label">{label}</span>
            {badge > 0 && <span className={`tabbar-badge${key === 'record' ? ' tabbar-badge-hl' : ''}`}>{badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
