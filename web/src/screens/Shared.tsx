import { useEffect, useState } from 'react';
import { client } from '../api/client';
import type { ModelList, SharedReview } from '../api/types';
import { ReviewCard } from '../components/ReviewCard';
import { SiteLinks } from './Start';
import { AVATARS } from '../game/avatar';
import type { Face } from '../game/avatar';
import { LANGUAGES, showLanguage, t } from '../i18n';
import type { Language } from '../i18n';

/** The sharer's avatar, if it is one this build knows. */
function faceOf(face: SharedReview['face']): Face | undefined {
  if (!face || !AVATARS.some((a) => a.id === face.id) || !/^#[0-9a-f]{6}$/i.test(face.color)) return undefined;
  return { id: face.id, color: face.color };
}

/** A review someone shared, at /r/<id>. */
export function Shared({ id }: { id: string }) {
  const [review, setReview] = useState<SharedReview | null>(null);
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<ModelList | null>(null);
  useEffect(() => {
    client.getReview(id).then(
      (r) => {
        // The review reads in the language it was written in, whatever the visitor's own choice.
        if (LANGUAGES.includes(r.language as Language)) showLanguage(r.language as Language);
        setReview(r);
      },
      () => setMissing(true),
    );
    client.getModels().then(setSite, () => {});
  }, [id]);

  if (missing)
    return (
      <main className="end">
        <div className="end-col">
          <article className="review">
            <h1 className="review-missing">{t('shared.missing')}</h1>
            <footer className="review-foot">
              <a className="btn btn-ink btn-big" href="/">
                {t('shared.takeShift')}
              </a>
            </footer>
          </article>
        </div>
      </main>
    );
  if (!review) return <div className="loading">{t('shared.loading')}</div>;
  return (
    <main className="end">
      <div className="end-col">
        <ReviewCard
          model={review.model}
          subagent={review.subagent}
          face={faceOf(review.face)}
          review={review.review}
          stats={review.stats}
          lost={review.lost}
          date={new Date(review.createdAt)}
          recordTitle={t('record.title')}
          destroyed={review.destroyed}
          note={[review.persona && t('shared.persona', { persona: t(`start.persona.${review.persona}`) }), review.customStance && t('shared.customStance')].filter(Boolean).join(' ') || undefined}
        >
          <a className="btn btn-ink btn-big" href="/">
            {t('shared.takeShiftYourself')}
          </a>
        </ReviewCard>
        <SiteLinks site={site} />
      </div>
    </main>
  );
}
