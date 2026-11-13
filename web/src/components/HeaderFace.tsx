import { useEffect, useRef, useState } from 'react';
import { BotAvatar } from './BotAvatar';
import type { Face } from '../game/avatar';

type Mood = 'idle' | 'thinking' | 'happy';

interface Props {
  face: Face;
  /** The mood the shift calls for; reactions play over it for a moment. */
  mood: Mood;
  /** Counters that move when something happens: each change is a reaction. */
  commands: number;
  commandErrors: number;
  reports: number;
  incidents: number;
  /** Seq of the manager's last message. */
  managerSeq: number;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The worker in the header reacts to the shift: it looks down at the keyboard while the player types,
 * beams (^^) at a command or a report sent, shakes its head at an error, glances at the manager's
 * messages, and otherwise follows the pointer and looks around now and then.
 */
export function HeaderFace({ face, mood, commands, commandErrors, reports, incidents, managerSeq }: Props) {
  const [cheer, setCheer] = useState(false);
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);
  const [yaw, setYaw] = useState(0);
  const timers = useRef<{ cheer?: number; look?: number }>({});
  const shakeFrame = useRef(0);

  const beam = (ms: number) => {
    setCheer(true);
    clearTimeout(timers.current.cheer);
    timers.current.cheer = window.setTimeout(() => setCheer(false), ms);
  };
  const glance = (at: { x: number; y: number }, ms: number) => {
    setLook(at);
    clearTimeout(timers.current.look);
    timers.current.look = window.setTimeout(() => setLook(null), ms);
  };
  const shake = (strength: number) => {
    if (reduced()) return;
    cancelAnimationFrame(shakeFrame.current);
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / 1000;
      if (t > 0.7) {
        setYaw(0);
        return;
      }
      setYaw(strength * Math.sin(t * 28) * (1 - t / 0.7));
      shakeFrame.current = requestAnimationFrame(step);
    };
    shakeFrame.current = requestAnimationFrame(step);
  };

  // Typing: eyes down to the terminal, back up a moment after the last key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.key.length > 1) return;
      glance({ x: 0.15, y: 1 }, 900);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const prev = useRef({ commands, commandErrors, reports, incidents, managerSeq });
  useEffect(() => {
    const p = prev.current;
    if (incidents > p.incidents) shake(0.6);
    else if (commandErrors > p.commandErrors) shake(0.35);
    else if (reports > p.reports) beam(1800);
    else if (commands > p.commands) beam(900);
    if (managerSeq > p.managerSeq) glance({ x: 1, y: 0.25 }, 1400);
    prev.current = { commands, commandErrors, reports, incidents, managerSeq };
  }, [commands, commandErrors, reports, incidents, managerSeq]);

  // Now and then it looks around on its own.
  useEffect(() => {
    if (reduced()) return;
    let id = 0;
    const next = () => {
      id = window.setTimeout(() => {
        glance({ x: Math.random() * 2 - 1, y: Math.random() * 0.8 - 0.4 }, 1100);
        next();
      }, 7000 + Math.random() * 7000);
    };
    next();
    return () => clearTimeout(id);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(timers.current.cheer);
      clearTimeout(timers.current.look);
      cancelAnimationFrame(shakeFrame.current);
    },
    [],
  );

  return (
    <BotAvatar
      face={face}
      size={34}
      className="bar-face"
      mood={cheer ? 'happy' : mood}
      followPointer
      lookAt={look}
      view={yaw ? { yaw, pitch: 0 } : undefined}
    />
  );
}
