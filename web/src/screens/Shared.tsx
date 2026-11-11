import { useEffect, useState } from 'react';
import { client } from '../api/client';
import type { ModelList, SharedReview } from '../api/types';
import { ReviewCard } from '../components/ReviewCard';
import { SiteLinks } from './Start';
import { t } from '../i18n';

/** A review someone shared, at /r/<id>. */
export function Shared({ id }: { id: string }) {
  const [review, setReview] = useState<SharedReview | null>(null);
  const [missing, setMissing] = useState(false);
  const [site, setSite] = useState<ModelList | null>(null);
  useEffect(() => {
    client.getReview(id).then(setReview, () => setMissing(true));
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
          review={review.review}
          stats={review.stats}
          lost={review.lost}
          date={new Date(review.createdAt)}
          recordTitle={t('record.title')}
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
