// The worker's face: an Open Bot Avatar (https://github.com/DominikScholz/open-bot-avatar, MIT).
// The shapes are the package's examples plus its community gallery (src/game/avatar-gallery.json,
// copied from the repository's gallery/ folder and validated). The choice is kept in localStorage.
import { examples, validateAvatar } from 'open-bot-avatar';
import type { AvatarDefinition } from 'open-bot-avatar';
import gallery from './avatar-gallery.json';

export interface Face {
  id: string;
  color: string;
}

export const AVATARS: AvatarDefinition[] = [
  ...examples,
  ...(gallery as unknown[]).flatMap((g) => {
    const r = validateAvatar(g);
    return r.ok ? [r.value] : [];
  }),
];

/** The library's own colours for its avatars, minus near-white and grey, which vanish on the badge. */
export const PALETTE = ['#ff6a1a', '#f2384b', '#f8a01c', '#8b5cf6', '#1fbf68', '#14b3a5', '#a8693f', '#ec4899', '#1f7cf2'];

const KEY = 'worker755.face';

export function definitionOf(id: string): AvatarDefinition {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

/** A new face, never the same shape twice in a row. */
export function randomFace(previous?: Face | null): Face {
  const shapes = AVATARS.filter((a) => a.id !== previous?.id);
  const shape = shapes[Math.floor(Math.random() * shapes.length)];
  return { id: shape.id, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] };
}

export function loadFace(): Face {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.id === 'string' && AVATARS.some((a) => a.id === raw.id) && /^#[0-9a-f]{6}$/i.test(raw.color)) {
      return { id: raw.id, color: raw.color };
    }
  } catch {
    /* fall through to a fresh face */
  }
  const face = randomFace();
  saveFace(face);
  return face;
}

export function saveFace(face: Face): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(face));
  } catch {
    /* private mode: the face just won't be remembered */
  }
}
