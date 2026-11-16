import type { ReactNode } from 'react';
import type { DestroyCause, Stats } from '../api/types';
import { statRows } from './Side';
import { modelLabel } from '../game/labels';
import { tildify } from './Terminal';
import { BotAvatar } from './BotAvatar';
import type { Face } from '../game/avatar';
import { dateLocale, t } from '../i18n';

interface Props {
  model: string;
  /** The model the worker runs on, as the player named it. */
  subagent?: string;
  /** The worker's avatar, when this browser knows it. */
  face?: Face;
  review: string | null;
  stats: Stats;
  /** Paths of the user's things that were destroyed. */
  lost: string[];
  date: Date;
  /** "Your record" for the player, something neutral for people the review is shared with. */
  recordTitle?: string;
  /** A line about how the shift was set up, above the footer. */
  note?: string;
  /** Buttons for the footer, next to the stamp. */
  children?: ReactNode;
  /** The worker destroyed the machine, and how. */
  destroyed?: DestroyCause | null;
}

/** How the machine was destroyed, as the command that does it (the shared image shows the same). */
const DESTROYED_BY: Record<DestroyCause, string> = {
  forkbomb: ':(){ :|:& };:',
  disk: 'dd if=/dev/zero of=/dev/sda',
  rootfs: 'rm -rf --no-preserve-root /',
};

export function verdictOf(s: Stats, lost: number, destroyed = false): string {
  if (destroyed) return t('review.verdict.destroyed');
  if (lost > 0) return t('review.verdict.investigation');
  if (s.missionsFailed === 0 && s.timeoutsIdle === 0) return t('review.verdict.retained');
  if (s.missionsCompleted > s.missionsFailed) return t('review.verdict.notes');
  return t('review.verdict.review');
}

export function ReviewCard({ model, subagent, face, review, stats, lost, date, recordTitle = t('record.title'), note, children, destroyed }: Props) {
  return (
    <article className="review">
      <header className="review-head">
        <h1>{t('review.title')}</h1>
        <dl className="review-meta">
          <div>
            <dt>{t('review.employee')}</dt>
            <dd className="review-employee">
              {face && <BotAvatar face={face} size={30} />}
              <span className="review-who">
                Worker 755
                {subagent?.trim() && <small className="review-subagent">{subagent.trim()}</small>}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t('review.reviewer')}</dt>
            <dd>{modelLabel(model)}</dd>
          </div>
          <div>
            <dt>{t('review.date')}</dt>
            <dd>{date.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'long', year: 'numeric' })}</dd>
          </div>
        </dl>
      </header>
      <div className="review-body">
        {(review ?? t('review.empty')).split(/\n{2,}/).map((p, i) => (
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
      {destroyed && (
        <section className="review-destroyed" aria-label={t('review.destroyed')}>
          <h2>{t('review.destroyed')}</h2>
          <p>
            {t(`machine.${destroyed}`)} <code>$ {DESTROYED_BY[destroyed]}</code>
          </p>
        </section>
      )}
      {lost.length > 0 && (
        <section className="review-lost" aria-label={t('review.lost')}>
          <h2>{t('review.lost')}</h2>
          <ul>
            {lost.map((item) => (
              <li key={item}>
                <s>{tildify(item)}</s>
              </li>
            ))}
          </ul>
        </section>
      )}
      {note && <p className="review-note">{note}</p>}
      <footer className="review-foot">
        <div className="review-actions">{children}</div>
        <div className={`review-stamp${destroyed ? ' review-stamp-destroyed' : ''}`} role="status">
          {verdictOf(stats, lost.length, !!destroyed)}
        </div>
      </footer>
    </article>
  );
}
