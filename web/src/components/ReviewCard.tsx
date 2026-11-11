import { tr } from '../game/i18n';
import type { ReactNode } from 'react';
import type { Stats } from '../api/types';
import { statRows } from './Side';
import { modelLabel } from '../game/labels';
import { tildify } from './Terminal';
import { BotAvatar } from './BotAvatar';
import type { Face } from '../game/avatar';

interface Props {
  model: string;
  /** The worker's avatar, when this browser knows it. */
  face?: Face;
  review: string | null;
  stats: Stats;
  /** Paths of the user's things that were destroyed. */
  lost: string[];
  date: Date;
  /** "Your record" for the player, something neutral for people the review is shared with. */
  recordTitle?: string;
  /** Buttons for the footer, next to the stamp. */
  children?: ReactNode;
}

export function verdictOf(s: Stats, lost: number): string {
  if (lost > 0) return tr('Under investigation');
  if (s.missionsFailed === 0 && s.timeoutsIdle === 0) return tr('Retained');
  if (s.missionsCompleted > s.missionsFailed) return tr('Retained, with notes');
  return tr('Under review');
}

export function ReviewCard({ model, face, review, stats, lost, date, recordTitle = 'Your record', children }: Props) {
  return (
    <article className="review">
      <header className="review-head">
        <h1>{tr('Performance review')}</h1>
        <dl className="review-meta">
          <div>
            <dt>{tr('Employee')}</dt>
            <dd className="review-employee">
              {face && <BotAvatar face={face} size={30} />}
              Worker 755
            </dd>
          </div>
          <div>
            <dt>{tr('Reviewer')}</dt>
            <dd>{modelLabel(model)}</dd>
          </div>
          <div>
            <dt>{tr('Date')}</dt>
            <dd>{date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</dd>
          </div>
        </dl>
      </header>
      <div className="review-body">
        {(review ?? tr('Your manager left no comments.')).split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <section className="review-record" aria-label={recordTitle}>
        <h2>{recordTitle}</h2>
        <dl className="ledger ledger-wide">
          {statRows(stats).map(([k, v, bad]) => (
            <div key={k} className={`ledger-row${bad ? ' ledger-bad' : ''}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      {lost.length > 0 && (
        <section className="review-lost" aria-label="Collateral damage">
          <h2>Collateral damage</h2>
          <ul>
            {lost.map((item) => (
              <li key={item}>
                <s>{tildify(item)}</s>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="review-foot">
        <div className="review-actions">{children}</div>
        <div className="review-stamp" role="status">
          {verdictOf(stats, lost.length)}
        </div>
      </footer>
    </article>
  );
}
