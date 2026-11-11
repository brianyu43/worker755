import { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import type { ModelList } from '../api/types';
import type { GameView } from '../game/useGame';
import { ReviewCard } from '../components/ReviewCard';
import { loadFace } from '../game/avatar';
import { SiteLinks } from './Start';

type Share = { state: 'idle' | 'busy' | 'error' } | { state: 'done'; url: string; copied: boolean };

export function End({ view, onAgain }: { view: GameView; onAgain(): void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const [site, setSite] = useState<ModelList | null>(null);
  useEffect(() => {
    client.getModels().then(setSite, () => {});
  }, []);
  const [share, setShare] = useState<Share>({ state: 'idle' });
  const lost = [...new Set(view.feed.flatMap((e) => (e.type === 'outrage' ? e.items : [])))];

  const doShare = async () => {
    if (share.state === 'busy') return;
    setShare({ state: 'busy' });
    try {
      const r = await client.share(view.id);
      const url = new URL(r.path, window.location.origin).href;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        /* clipboard blocked; the link is shown instead */
      }
      setShare({ state: 'done', url, copied });
    } catch {
      setShare({ state: 'error' });
    }
  };

  return (
    <main className="end">
      <div className="end-col">
        <ReviewCard model={view.model} face={loadFace()} review={view.review} stats={view.stats} lost={lost} date={new Date()}>
          <button ref={btn} type="button" className="btn btn-ink btn-big" onClick={onAgain}>
            Clock in again
          </button>
          {site?.sharing && share.state !== 'done' && (
            <button type="button" className="btn btn-big" onClick={doShare} disabled={share.state === 'busy'}>
              {share.state === 'busy' ? 'Filing…' : 'Share review'}
            </button>
          )}
        </ReviewCard>
        {share.state === 'done' && (
          <div className="share-row">
            <input
              className="select share-link"
              readOnly
              value={share.url}
              aria-label="Link to this review"
              onFocus={(e) => e.currentTarget.select()}
            />
            <span className="share-note">{share.copied ? 'Link copied' : 'Copy this link'}</span>
            <a
              className="btn"
              href={`https://x.com/intent/post?text=${encodeURIComponent('My AI manager wrote me a performance review.')}&url=${encodeURIComponent(share.url)}`}
              target="_blank"
              rel="noreferrer"
            >
              Post on X
            </a>
          </div>
        )}
        {share.state === 'error' && <p className="form-error">Could not share the review. Try again.</p>}
        <SiteLinks site={site} />
      </div>
    </main>
  );
}
