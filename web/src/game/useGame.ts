import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import type { NewSession } from '../api/client';
import type { GameEvent, MissionKind, OpenInstruction, SessionState, Stats, TreeNode } from '../api/types';

export type ManagerState = 'thinking' | 'waiting' | 'idle';
export type ClosedOutcome = 'reported' | 'timeout_idle' | 'timeout_partial';

export interface GameView {
  id: string;
  model: string;
  /** The model the player said they run on. */
  subagent: string;
  status: SessionState['status'];
  cwd: string;
  tree: TreeNode;
  missionIndex: number;
  missionTotal: number;
  mission: { title: string; brief: string; kind?: MissionKind } | null;
  instruction: OpenInstruction | null;
  /** The instruction that just closed, kept briefly so its outcome can be shown. */
  closed: { instruction: OpenInstruction; outcome: ClosedOutcome; at: number } | null;
  manager: ManagerState;
  feed: GameEvent[];
  stats: Stats;
  review: string | null;
  error: string | null;
  lastSeq: number;
}

const FEED_TYPES = new Set<GameEvent['type']>([
  'mission',
  'manager_text',
  'manager_thinking',
  'director_text',
  'outrage',
  'incident',
  'manager_tool',
  'instruction',
  'instruction_result',
  'mission_end',
  'error',
]);

function apply(v: GameView, ev: GameEvent): GameView {
  if (ev.seq <= v.lastSeq) return v;
  const n: GameView = { ...v, lastSeq: ev.seq };
  if (FEED_TYPES.has(ev.type)) n.feed = [...v.feed, ev];
  switch (ev.type) {
    case 'mission':
      n.missionIndex = ev.index;
      n.missionTotal = ev.total;
      n.mission = { title: ev.title, brief: ev.brief, kind: ev.kind };
      break;
    case 'manager_status':
      n.manager = ev.state;
      break;
    case 'instruction':
      n.instruction = ev.instruction;
      n.closed = null;
      n.manager = 'waiting';
      break;
    case 'instruction_result':
      if (v.instruction && v.instruction.id === ev.id) {
        n.closed = { instruction: v.instruction, outcome: ev.outcome, at: ev.ts };
        n.instruction = null;
      }
      break;
    case 'fs':
      if (ev.tree) n.tree = ev.tree;
      n.cwd = ev.cwd;
      break;
    case 'stats':
      n.stats = ev.stats;
      break;
    case 'game_over':
      n.review = ev.review;
      n.stats = ev.stats;
      n.status = 'finished';
      n.instruction = null;
      break;
    case 'error':
      n.error = ev.message;
      n.status = 'error';
      n.instruction = null;
      n.manager = 'idle';
      break;
  }
  return n;
}

function fromSnapshot(s: SessionState): GameView {
  let v: GameView = {
    id: s.id,
    model: s.model,
    subagent: s.subagent,
    status: s.status,
    cwd: s.cwd,
    tree: s.tree,
    missionIndex: s.missionIndex,
    missionTotal: s.missionTotal,
    mission: null,
    instruction: null,
    closed: null,
    manager: 'thinking',
    feed: [],
    stats: s.stats,
    review: null,
    error: null,
    lastSeq: 0,
  };
  for (const ev of s.events) v = apply(v, ev);
  // The snapshot is authoritative for current state; events only rebuild the history.
  return {
    ...v,
    status: s.status,
    cwd: s.cwd,
    tree: s.tree,
    instruction: s.instruction,
    closed: s.instruction ? null : v.closed,
    stats: s.stats,
    missionIndex: s.missionIndex,
    missionTotal: s.missionTotal,
  };
}

export function useGame() {
  const [view, setView] = useState<GameView | null>(null);
  const [connected, setConnected] = useState(true);
  // Estimated (local clock - server clock), the smallest delay seen. Deadlines are server time.
  const skew = useRef<number | null>(null);
  const subRef = useRef<{ close(): void } | null>(null);
  const listeners = useRef(new Set<(ev: GameEvent) => void>());

  const attach = useCallback((s: SessionState) => {
    subRef.current?.close();
    const v = fromSnapshot(s);
    setView(v);
    subRef.current = client.subscribe(s.id, v.lastSeq, {
      onEvent(ev) {
        const d = Date.now() - ev.ts;
        if (skew.current === null || d < skew.current) skew.current = d;
        setView((cur) => (cur && cur.id === s.id ? apply(cur, ev) : cur));
        for (const l of listeners.current) l(ev);
      },
      onConnection: setConnected,
    });
  }, []);

  const start = useCallback(
    async (opts: NewSession) => {
      skew.current = null;
      const s = await client.createSession(opts);
      attach(s);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('s', s.id);
        window.history.replaceState(null, '', url);
      } catch {
        /* ignore */
      }
    },
    [attach],
  );

  const resume = useCallback(
    async (id: string) => {
      const s = await client.getSession(id);
      attach(s);
    },
    [attach],
  );

  const leave = useCallback(() => {
    subRef.current?.close();
    subRef.current = null;
    setView(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState(null, '', url);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => () => subRef.current?.close(), []);

  const serverNow = useCallback(() => Date.now() - (skew.current ?? 0), []);

  const onEvent = useCallback((fn: (ev: GameEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { view, connected, start, resume, leave, serverNow, onEvent };
}

export type Game = ReturnType<typeof useGame>;
