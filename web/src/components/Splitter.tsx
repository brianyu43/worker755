import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { t } from '../i18n';

// Desktop panel sizes the player dragged, kept per device. Each is a CSS variable on `.desk`; when
// one is unset the stylesheet's own proportions apply. Phones never show the handles.

type Kind = 'left' | 'side' | 'order' | 'editor';

interface Spec {
  /** CSS variable holding the size in px. */
  prop: string;
  axis: 'x' | 'y';
  /** +1 when dragging right/down grows the panel, -1 when it shrinks it. */
  sign: 1 | -1;
  /** The element whose size the handle sets, relative to the handle. */
  target: 'parent' | 'prev' | 'next';
  min: number;
  /** The neighbour that gives up the space, and how small it may get. */
  room: string;
  roomMin: number;
}

const SPECS: Record<Kind, Spec> = {
  left: { prop: '--left-w', axis: 'x', sign: 1, target: 'parent', min: 180, room: '.desk-main', roomMin: 420 },
  side: { prop: '--side-w', axis: 'x', sign: -1, target: 'parent', min: 300, room: '.desk-main', roomMin: 420 },
  order: { prop: '--order-h', axis: 'y', sign: 1, target: 'prev', min: 120, room: '.term', roomMin: 200 },
  editor: { prop: '--editor-w', axis: 'x', sign: -1, target: 'next', min: 240, room: '.term-scroll', roomMin: 240 },
};

const KEY = 'w755-desk';
const STEP = 16;

type Sizes = Partial<Record<Kind, number>>;

function load(): Sizes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Sizes = {};
    for (const kind of Object.keys(SPECS) as Kind[]) {
      const v = (raw as Record<string, unknown>)[kind];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[kind] = Math.round(v);
    }
    return out;
  } catch {
    return {};
  }
}

function save(kind: Kind, size: number | null) {
  const sizes = load();
  if (size == null) delete sizes[kind];
  else sizes[kind] = size;
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    // Private mode or a full quota: the size still applies for this visit.
  }
}

/** The saved sizes as CSS variables, for the `.desk` element's first render. */
export function deskSizes(): CSSProperties {
  const style: Record<string, string> = {};
  for (const [kind, size] of Object.entries(load()) as [Kind, number][]) style[SPECS[kind].prop] = `${size}px`;
  return style as CSSProperties;
}

function targetOf(handle: HTMLElement, spec: Spec) {
  const el =
    spec.target === 'parent'
      ? handle.parentElement
      : spec.target === 'prev'
        ? handle.previousElementSibling
        : handle.nextElementSibling;
  return el instanceof HTMLElement ? el : null;
}

function measure(el: Element, axis: Spec['axis']) {
  const r = el.getBoundingClientRect();
  return axis === 'x' ? r.width : r.height;
}

/** Starts a resize: returns a function mapping a pointer/key offset to the new size, or null. */
function begin(handle: HTMLElement, spec: Spec) {
  const desk = handle.closest<HTMLElement>('.desk');
  const target = targetOf(handle, spec);
  const room = desk?.querySelector(spec.room);
  if (!desk || !target || !room) return null;
  const start = measure(target, spec.axis);
  const max = Math.max(spec.min, start + measure(room, spec.axis) - spec.roomMin);
  return (delta: number) => {
    const size = Math.round(Math.min(max, Math.max(spec.min, start + spec.sign * delta)));
    desk.style.setProperty(spec.prop, `${size}px`);
    return size;
  };
}

export function Splitter({ kind }: { kind: Kind }) {
  const spec = SPECS[kind];

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const resize = begin(handle, spec);
    if (!resize) return;
    e.preventDefault();
    const origin = spec.axis === 'x' ? e.clientX : e.clientY;
    let size: number | null = null;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add(`resizing-${spec.axis}`);
    const move = (ev: globalThis.PointerEvent) => {
      size = resize((spec.axis === 'x' ? ev.clientX : ev.clientY) - origin);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.documentElement.classList.remove(`resizing-${spec.axis}`);
      if (size != null) save(kind, size);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = spec.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const dir = keys.indexOf(e.key);
    if (dir < 0) return;
    e.preventDefault();
    const resize = begin(e.currentTarget, spec);
    if (resize) save(kind, resize(dir === 0 ? -STEP : STEP));
  };

  const reset = (e: { currentTarget: HTMLElement }) => {
    e.currentTarget.closest<HTMLElement>('.desk')?.style.removeProperty(spec.prop);
    save(kind, null);
  };

  return (
    <div
      className={`split split-${spec.axis} split-${kind}`}
      role="separator"
      aria-orientation={spec.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={t('desk.resize')}
      title={t('desk.resize')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    />
  );
}
