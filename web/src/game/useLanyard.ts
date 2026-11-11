// The badge hangs on a lanyard: grab it and it swings and stretches toward the pointer, let go and it
// springs back and settles. A damped spring per axis, stepped once per frame.
import { useEffect, useRef } from 'react';

/** Where the badge rests, and where its strap is pinned (px above the badge's top edge, as in the CSS). */
const REST_ANGLE = -3;
const PIVOT_ABOVE = 200;
const MAX_STRETCH = 70;
const MAX_ANGLE = 55;

interface Spring {
  angle: number; // degrees
  angleV: number;
  stretch: number; // px
  stretchV: number;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useLanyard<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s: Spring = { angle: REST_ANGLE, angleV: 0, stretch: 0, stretchV: 0 };
    let dragging = false;
    let grab = { angle: 0, dist: 0 };
    let last = { angle: REST_ANGLE, t: 0 };
    let frame = 0;
    let touched = false;

    const paint = () => {
      el.style.transform = `translateY(${s.stretch.toFixed(2)}px) rotate(${s.angle.toFixed(3)}deg)`;
    };
    // The pin point in page coordinates. The badge's own box moves as it swings, so measure its
    // untransformed holder, whose top is where the badge's top rests.
    const pivot = () => {
      const r = (el.parentElement ?? el).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top - PIVOT_ABOVE };
    };
    const polar = (e: PointerEvent) => {
      const p = pivot();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      return { angle: (-Math.atan2(dx, dy) * 180) / Math.PI, dist: Math.hypot(dx, dy) };
    };

    const step = (t: number) => {
      const dt = Math.min(0.032, (t - (last.t || t)) / 1000) || 0.016;
      last.t = t;
      if (!dragging) {
        // Pendulum-ish swing on the angle, a bouncier spring on the stretch.
        const aAcc = -38 * (s.angle - REST_ANGLE) - 2.6 * s.angleV;
        const sAcc = -170 * s.stretch - 9 * s.stretchV;
        s.angleV += aAcc * dt;
        s.angle += s.angleV * dt;
        s.stretchV += sAcc * dt;
        s.stretch += s.stretchV * dt;
        const still =
          Math.abs(s.angle - REST_ANGLE) < 0.02 && Math.abs(s.angleV) < 0.05 && Math.abs(s.stretch) < 0.05 && Math.abs(s.stretchV) < 0.1;
        if (still) {
          s.angle = REST_ANGLE;
          s.stretch = 0;
          paint();
          frame = 0;
          return;
        }
      }
      paint();
      frame = requestAnimationFrame(step);
    };
    const run = () => {
      if (!frame) {
        last.t = 0;
        frame = requestAnimationFrame(step);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select')) return;
      if (!touched) {
        // Take over from the entrance animation.
        touched = true;
        el.style.animation = 'none';
      }
      dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('badge-held');
      const p = polar(e);
      grab = { angle: p.angle - s.angle, dist: p.dist - s.stretch };
      last = { angle: s.angle, t: performance.now() };
      s.angleV = 0;
      s.stretchV = 0;
      run();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const p = polar(e);
      const now = performance.now();
      const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, p.angle - grab.angle));
      // Pulling down stretches the strap, with more resistance the further it goes.
      const pull = Math.max(0, p.dist - grab.dist);
      const stretch = MAX_STRETCH * (1 - Math.exp(-pull / MAX_STRETCH));
      const dt = Math.max(1, now - last.t) / 1000;
      s.angleV = 0.6 * s.angleV + 0.4 * ((angle - s.angle) / dt);
      s.angle = angle;
      s.stretch = stretch;
      last = { angle, t: now };
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('badge-held');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      s.angleV = Math.max(-400, Math.min(400, s.angleV));
      if (reduced()) {
        s.angle = REST_ANGLE;
        s.stretch = 0;
        s.angleV = s.stretchV = 0;
      }
      run();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, []);
  return ref;
}
