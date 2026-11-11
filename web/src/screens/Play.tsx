import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import { Feed } from '../components/Feed';
import { FileTree, StatsPanel } from '../components/Side';
import { Terminal, type TerminalHandle } from '../components/Terminal';
import { WorkOrder, formatClock, remainingOf, urgencyOf, useTicker } from '../components/WorkOrder';
import { MOD } from '../game/keys';
import { modelLabel } from '../game/labels';
import { BotAvatar } from '../components/BotAvatar';
import { loadFace } from '../game/avatar';
import type { Game, GameView } from '../game/useGame';
import { t } from '../i18n';

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
  const [pleased, setPleased] = useState(false);
  const open = view.instruction;
  const instructionCount = view.feed.filter((e) => e.type === 'instruction').length;

  useTicker(open !== null, 250);
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
        term.current?.focus();
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
      if (document.activeElement === document.body) term.current?.focus();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const finished = view.status === 'finished';
  const cutShort = view.status === 'error';

  return (
    <div className={`play${urgency ? ` play-${urgency}` : ''}${flash ? ` play-flash-${flash}` : ''}`}>
      <header className="bar">
        <div className="bar-id">
          <span className="bar-badge">755</span>
          <BotAvatar
            face={face}
            size={34}
            className="bar-face"
            mood={pleased ? 'happy' : open ? 'thinking' : 'idle'}
          />
          <span className="bar-name">Worker 755</span>
        </div>
        <div className="bar-mission">
          {view.mission ? (
            <>
              <span className="bar-step">
                {view.missionIndex + 1}/{view.missionTotal}
              </span>
              <span className="bar-title">{view.mission.title}</span>
            </>
          ) : (
            <span className="bar-title">{t('play.waiting')}</span>
          )}
        </div>
        {!game.connected && <span className="bar-offline">{t('play.reconnecting')}</span>}
        {open && (
          <div className={`bar-clock bar-clock-${urgency}`} aria-hidden>
            {formatClock(remaining)}
          </div>
        )}
      </header>

      <div className="desk">
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
          ) : (
            <WorkOrder
              instruction={view.instruction}
              closed={view.closed}
              manager={view.manager}
              serverNow={game.serverNow}
              count={instructionCount}
            />
          )}
          <Terminal ref={term} sessionId={view.id} cwd={view.cwd} tree={view.tree} onReport={report} />
          <form
            className={`report${open ? ' report-open' : ''}`}
            onSubmit={(e) => {
              e.preventDefault();
              void report(note);
            }}
          >
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
            <button type="submit" className="btn btn-report" disabled={!open || reporting}>
              {t('play.report')} <kbd>{MOD} ↵</kbd>
            </button>
          </form>
        </div>
        <aside className="desk-side">
          <Feed feed={view.feed} manager={view.manager} model={modelLabel(view.model)} />
          <div className="side-pair">
            <FileTree tree={view.tree} cwd={view.cwd} />
            <StatsPanel stats={view.stats} />
          </div>
        </aside>
      </div>
    </div>
  );
}
