import { useEffect, useRef } from 'react';
import { signInUrl } from '../api/account';
import type { Me } from '../api/account';
import { t } from '../i18n';
import { TopUps, UsageMeter } from './Usage';

/** Why a shift on our key could not start: the player is not signed in, or their usage is used up. */
export type OfferKind = 'signIn' | 'limit';

interface Props {
  kind: OfferKind | null;
  me: Me | null;
  /** Where the source lives, for running it yourself; empty hides that option. */
  sourceUrl: string;
  buying: boolean;
  error: string | null;
  onTopUp(amount: number): void;
  onOwnKey(): void;
  onClose(): void;
}

/** Shown on clocking in when a free shift cannot start, with the ways to play on. */
export function ShiftOffer({ kind, me, sourceUrl, buying, error, onTopUp, onOwnKey, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (kind && !d.open) d.showModal();
    else if (!kind && d.open) d.close();
  }, [kind]);

  return (
    <dialog
      ref={ref}
      className="end-dialog"
      aria-labelledby="offer-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {kind && (
        <div className="end-sheet offer-sheet">
          <h2 className="end-title" id="offer-title">
            {t(kind === 'signIn' ? 'offer.signIn.title' : 'limit.title')}
          </h2>
          <p className="end-text">{t(kind === 'signIn' ? 'offer.signIn.body' : 'limit.body')}</p>
          {kind === 'limit' && me?.account && <UsageMeter usage={me.account.usage} className="offer-usage" />}
          {kind === 'limit' && <TopUps amounts={me?.topUps ?? []} busy={buying} onTopUp={onTopUp} />}
          <div className="offer-actions">
            {kind === 'signIn' &&
              me?.signIn.map((p) => (
                <a key={p} className="btn btn-ink" href={signInUrl(p)}>
                  {t(p === 'google' ? 'start.signIn.google' : 'start.signIn.github')}
                </a>
              ))}
            <button type="button" className="btn" onClick={onOwnKey}>
              {t('offer.ownKey')}
            </button>
            {kind === 'limit' && sourceUrl && (
              <a className="btn" href={`${sourceUrl}#run-it`} target="_blank" rel="noreferrer">
                {t('offer.selfHost')}
              </a>
            )}
          </div>
          {error && <p className="form-error end-error">{error}</p>}
          {/* Last, so the dialog opens with the first way to play on in focus. */}
          <button type="button" className="offer-close" onClick={onClose} aria-label={t('offer.close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </dialog>
  );
}
