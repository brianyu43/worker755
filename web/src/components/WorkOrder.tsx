import { useEffect, useState } from 'react';
import type { OpenInstruction } from '../api/types';
import type { ClosedOutcome, ManagerState } from '../game/useGame';

export type Urgency = 'calm' | 'warn' | 'critical' | 'over';

export function urgencyOf(remainingMs: number, durationMs = 90_000): Urgency {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= Math.min(10_000, durationMs / 6)) return 'critical';
  if (remainingMs <= Math.min(30_000, durationMs / 3)) return 'warn';
  return 'calm';
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
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

const STAMP: Record<ClosedOutcome, string> = {
  reported: 'Received',
  timeout_idle: 'No response',
  timeout_partial: 'Late',
};

interface Props {
  instruction: OpenInstruction | null;
  closed: { instruction: OpenInstruction; outcome: ClosedOutcome; at: number } | null;
  manager: ManagerState;
  serverNow(): number;
  count: number;
}

export function WorkOrder({ instruction, closed, manager, serverNow, count }: Props) {
  // Show the stamped, closed instruction for a beat before clearing the desk.
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => {
    if (!closed) return;
    setShowClosed(true);
    const t = setTimeout(() => setShowClosed(false), 2600);
    return () => clearTimeout(t);
  }, [closed]);

  useTicker(instruction !== null);

  const inst = instruction ?? (showClosed && closed ? closed.instruction : null);
  if (!inst) {
    return (
      <section className="order order-empty" aria-live="polite">
        <div className="order-empty-text">
          {manager === 'thinking'
              ? count === 0
                ? 'Your manager is reading the assignment.'
                : 'Your manager is deciding what you do next.'
              : 'No instruction. Stand by.'}
        </div>
        <div className="order-empty-dots" aria-hidden />
      </section>
    );
  }

  const open = instruction !== null;
  const remaining = open ? remainingOf(inst, serverNow()) : 0;
  const urgency: Urgency = open ? urgencyOf(remaining, inst.durationMs) : 'over';
  const frac = open ? remaining / inst.durationMs : 0;
  const outcome = !open && closed ? closed.outcome : null;
  const secondKey = Math.ceil(remaining / 1000);

  return (
    <section
      className={`order order-${urgency}${outcome ? ` order-closed order-${outcome}` : ''}`}
      key={inst.id}
      aria-label="Current instruction"
    >
      <div className="order-drain" style={{ transform: `scaleX(${frac})` }} aria-hidden />
      <header className="order-head">
        <div className="order-meta">
          <span className="order-no">Instruction {count}</span>
          <h2 className="order-title">{inst.description}</h2>
        </div>
        <div className="order-clock" role="timer" aria-label="Time left">
          <span key={urgency === 'critical' ? secondKey : 'steady'} className="order-digits">
            {formatClock(remaining, true)}
          </span>
        </div>
      </header>
      <div className="order-text">{inst.text}</div>
      {outcome && (
        <div className={`stamp stamp-${outcome}`} role="status">
          {STAMP[outcome]}
        </div>
      )}
    </section>
  );
}
