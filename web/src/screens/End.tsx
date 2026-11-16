import { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import type { ModelList } from '../api/types';
import type { GameView } from '../game/useGame';
import { ReviewCard } from '../components/ReviewCard';
import { loadFace } from '../game/avatar';
import { SiteLinks } from './Start';
import { t } from '../i18n';

type Share = { state: 'idle' | 'busy' | 'error' } | { state: 'done'; url: string; copied: boolean };

export function End({ view, onAgain }: { view: GameView; onAgain(): void }) {
  const btn = useRef<HTMLButtonElement>(null);
  // The review reads from the top: focus the button for the keyboard without scrolling down to it,
  // and drop whatever scroll the shift screen left behind.
  useEffect(() => {
    window.scrollTo(0, 0);
    btn.current?.focus({ preventScroll: true });
  }, []);
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
      const r = await client.share(view.id, loadFace());
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
        <ReviewCard model={view.model} subagent={view.subagent} face={loadFace()} review={view.review} stats={view.stats} lost={lost} date={new Date()} destroyed={view.destroyed}>
          <button ref={btn} type="button" className="btn btn-ink btn-big" onClick={onAgain}>
            {t('app.clockInAgain')}
          </button>
          {site?.sharing && share.state !== 'done' && (
            <button type="button" className="btn btn-big" onClick={doShare} disabled={share.state === 'busy'}>
              {share.state === 'busy' ? t('end.filing') : t('end.share')}
            </button>
          )}
        </ReviewCard>
        {share.state === 'done' && (
          <div className="share-row">
            <input
              className="select share-link"
              readOnly
              value={share.url}
              aria-label={t('end.link')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <span className="share-note">{share.copied ? t('end.copied') : t('end.copy')}</span>
            <a
              className="btn"
              href={`https://x.com/intent/post?text=${encodeURIComponent(t('end.postText'))}&url=${encodeURIComponent(share.url)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('end.post')}
            </a>
          </div>
        )}
        {share.state === 'error' && <p className="form-error">{t('end.shareFailed')}</p>}
        <SiteLinks site={site} />
      </div>
    </main>
  );
}
