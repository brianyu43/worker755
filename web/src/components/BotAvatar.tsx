import { useEffect, useRef } from 'react';
import { mountAvatar } from 'open-bot-avatar/dom';
import type { MountedAvatar } from 'open-bot-avatar/dom';
import { definitionOf } from '../game/avatar';
import type { Face } from '../game/avatar';

interface Props {
  face: Face;
  size: number;
  mood?: 'idle' | 'thinking' | 'happy';
  followPointer?: boolean;
  /** A fixed look direction (-1..1 per axis), over the pointer. */
  lookAt?: { x: number; y: number } | null;
  /** Extra head turn in radians. */
  view?: { yaw: number; pitch: number };
  className?: string;
}

/** A live avatar, after the React example in the library's README. Decorative: the badge says who it is. */
export function BotAvatar({ face, size, mood = 'idle', followPointer = false, lookAt = null, view, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);
  const options = { definition: definitionOf(face.id), color: face.color, mood, followPointer, lookAt, view: view ?? { yaw: 0, pitch: 0 }, label: '' };
  useEffect(() => {
    avatar.current = mountAvatar(host.current!, options);
    return () => {
      avatar.current?.destroy();
      avatar.current = null;
    };
    // Mounted once; later changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    avatar.current?.update(options);
  });
  return <div ref={host} className={className} style={{ width: size, aspectRatio: '1' }} aria-hidden />;
}
