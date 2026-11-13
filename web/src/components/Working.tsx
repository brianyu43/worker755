import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import type { Key } from '../i18n';

/** What the manager is busy with, which picks the verbs it cycles through. */
export type Activity = 'reading' | 'thinking' | 'checking' | 'reviewing';

const VERBS: Record<Activity, number> = { reading: 4, thinking: 8, checking: 6, reviewing: 5 };

/** The star's frames, out and back, like a terminal agent at work. */
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const VERB_MS = 3200;

/**
 * When each activity started, shared by every line showing it (the desk and the feed), so both
 * show the same verb and the same count. Dropped when the last of them goes away.
 */
const started = new Map<Activity, { since: number; users: number }>();

function useSince(activity: Activity): number {
  const since = useMemo(() => {
    const cur = started.get(activity) ?? { since: Date.now(), users: 0 };
    started.set(activity, cur);
    return cur.since;
  }, [activity]);
  useEffect(() => {
    const cur = started.get(activity) ?? { since, users: 0 };
    cur.users += 1;
    started.set(activity, cur);
    return () => {
      cur.users -= 1;
      if (cur.users <= 0 && started.get(activity) === cur) started.delete(activity);
    };
  }, [activity, since]);
  return since;
}

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** A twitching star, what the manager is doing right now, and how long it has been at it. */
export function Working({ activity, className }: { activity: Activity; className?: string }) {
  const since = useSince(activity);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - since);
  const frame = still() ? FRAMES[4] : FRAMES[Math.floor(elapsed / 120) % FRAMES.length];
  // Start somewhere different each time, then move on every few seconds.
  const n = VERBS[activity];
  const verb = (Math.floor(since / 1000) + Math.floor(elapsed / VERB_MS)) % n;
  return (
    // Decoration: the phase is announced elsewhere, and a line that changes every second would be noise.
    <span className={`working${className ? ` ${className}` : ''}`} aria-hidden>
      <span className="working-star">
        {frame}
      </span>
      <span className="working-verb" key={verb}>
        {t(`work.${activity}.${verb + 1}` as Key)}…
      </span>
      <span className="working-time">{Math.floor(elapsed / 1000)}s</span>
    </span>
  );
}
