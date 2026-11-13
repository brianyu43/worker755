import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps a scrolling log pinned to its newest line until the player scrolls up. Also catches up when
 * the log is resized or shown again (a phone tab), and does not mistake those for the player scrolling.
 */
export function useStickToBottom<T extends HTMLElement>(slack: number) {
  const ref = useRef<T>(null);
  const stick = useRef(true);
  const size = useRef('');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = `${el.clientWidth}x${el.clientHeight}`;
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el || `${el.clientWidth}x${el.clientHeight}` !== size.current) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < slack;
  }, [slack]);
  return { ref, stick, onScroll };
}
