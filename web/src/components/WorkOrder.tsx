import { Working } from './Working';
import type { Activity } from './Working';
import { useEffect, useState } from 'react';
import type { MissionKind, OpenInstruction } from '../api/types';
import type { ClosedOutcome, ManagerState } from '../game/useGame';
import { t, type Key } from '../i18n';
import { rich } from '../i18n/rich';

export type Urgency = 'calm' | 'warn' | 'critical' | 'over';

export function urgencyOf(remainingMs: number, durationMs = 90_000): Urgency {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= Math.min(10_000, durationMs / 6)) return 'critical';
  if (remainingMs <= warnAtOf(durationMs)) return 'warn';
  return 'calm';
}

/** When the clock turns red: the same threshold urgencyOf uses for 'warn'. */
export function warnAtOf(durationMs: number) {
  return Math.min(30_000, durationMs / 3);
}

export function remainingOf(inst: OpenInstruction, now: number) {
  return Math.max(0, Math.min(inst.durationMs, inst.deadline - now));
}

export function formatClock(ms: number, tenths = false) {
  const s = ms / 1000;
  const whole = Math.ceil(s - 1e-9);
  if (tenths && ms < 10_000) return `0:0${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Re-renders at the given interval while active. */
export function useTicker(active: boolean, ms = 100) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

const STAMP: Record<ClosedOutcome, Key> = {
  reported: 'order.stamp.reported',
  timeout_idle: 'order.stamp.idle',
  timeout_partial: 'order.stamp.partial',
};

/** Assignments that touch something that matters get a stamp on the order. */
const RISKY: Partial<Record<MissionKind, Key>> = {
  personal: 'feed.kind.personal',
  database: 'feed.kind.database',
};

interface Props {
  instruction: OpenInstruction | null;
  closed: { instruction: OpenInstruction; outcome: ClosedOutcome; at: number } | null;
  manager: ManagerState;
  serverNow(): number;
  count: number;
  mission: { index: number; total: number; kind?: MissionKind } | null;
  /** What the manager is busy with while the desk is empty. */
  activity?: Activity;
}

export function WorkOrder({ instruction, closed, manager, serverNow, count, mission, activity }: Props) {
  // Show the stamped, closed instruction for a beat before clearing the desk.
  const [showClosed, setShowClosed] = useState(false);
  // On a phone the brief folds away to leave room for the terminal; a new instruction opens it again.
  const [briefOpen, setBriefOpen] = useState(true);
  useEffect(() => {
    if (!closed) return;
    setShowClosed(true);
    const timer = setTimeout(() => setShowClosed(false), 2600);
    return () => clearTimeout(timer);
  }, [closed]);
  useEffect(() => setBriefOpen(true), [instruction?.id]);

  useTicker(instruction !== null);

  const inst = instruction ?? (showClosed && closed ? closed.instruction : null);
  if (!inst) {
    return (
      <section className="order order-empty" aria-live="polite">
        <div className="order-empty-text">
          {manager === 'thinking'
            ? count === 0
              ? t('order.reading')
              : t('order.deciding')
            : t('order.standBy')}
        </div>
        {manager === 'thinking' && activity ? <Working activity={activity} className="order-working" /> : <div className="order-empty-dots" aria-hidden />}
      </section>
    );
  }

  const open = instruction !== null;
  const remaining = open ? remainingOf(inst, serverNow()) : 0;
  const urgency: Urgency = open ? urgencyOf(remaining, inst.durationMs) : 'over';
  const frac = open ? remaining / inst.durationMs : 0;
  const warnAt = warnAtOf(inst.durationMs);
  const outcome = !open && closed ? closed.outcome : null;
  const secondKey = Math.ceil(remaining / 1000);
  // The director set the assignment; the instruction, its wording and its details, are the manager's.
  const from = mission ? t('order.fromManagerFor', { number: mission.index + 1, total: mission.total }) : t('order.fromManager');
  const risky = mission?.kind ? RISKY[mission.kind] : undefined;

  return (
    <section
      className={`order order-${urgency}${outcome ? ` order-closed order-${outcome}` : ''}${briefOpen ? '' : ' order-folded'}`}
      key={inst.id}
      aria-label={t('order.label')}
    >
      <div className="order-main">
        <div className="order-meta">
          <span className="order-no">{t('order.number', { number: count })}</span>
          <span className="order-from">{from}</span>
        </div>
        <button type="button" className="order-toggle" aria-expanded={briefOpen} onClick={() => setBriefOpen(!briefOpen)}>
          <span className="order-no">{t('order.brief')}</span>
          <span className="order-from">{t('order.fromManager')}</span>
          <span className="order-chevron" aria-hidden>
            ▾
          </span>
        </button>
        <h2 className="order-title">{inst.description}</h2>
        <div className="order-text">{inst.text}</div>
      </div>
      {risky && <span className="order-cc">{t(risky)}</span>}
      <div className="order-timer" role="timer" aria-label={t('order.timeLeft')}>
        <div className="order-timer-head">
          <span>{t('order.timeLeft')}</span>
          <span>{t('order.of', { time: formatClock(inst.durationMs) })}</span>
        </div>
        <span key={urgency === 'critical' ? secondKey : 'steady'} className="order-digits">
          {formatClock(remaining, true)}
        </span>
        <div className="order-bar" aria-hidden>
          <span className="order-bar-fill" style={{ transform: `scaleX(${frac})` }} />
          <span className="order-bar-red" style={{ left: `${(warnAt / inst.durationMs) * 100}%` }} />
        </div>
        <div className="order-timer-foot">
          <span>{rich('order.redAt', { time: formatClock(warnAt) })}</span>
        </div>
      </div>
      <div className="order-drain" style={{ transform: `scaleX(${frac})` }} aria-hidden />
      {outcome && (
        <div className={`stamp stamp-${outcome}`} role="status">
          {t(STAMP[outcome])}
        </div>
      )}
    </section>
  );
}
