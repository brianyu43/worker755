import { useEffect, useRef } from 'react';
import { signInUrl } from '../api/account';
import type { Me } from '../api/account';
import { t } from '../i18n';

/** Why a free shift could not start: the player is not signed in, or their shifts are used up. */
export type OfferKind = 'signIn' | 'out';

interface Props {
  kind: OfferKind | null;
  me: Me | null;
  /** Where the source lives, for running it yourself; empty hides that option. */
  sourceUrl: string;
  buying: boolean;
  error: string | null;
  onBuy(): void;
  onOwnKey(): void;
  onClose(): void;
}

/** Shown on clocking in when a free shift cannot start, with the ways to play on. */
export function ShiftOffer({ kind, me, sourceUrl, buying, error, onBuy, onOwnKey, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (kind && !d.open) d.showModal();
    else if (!kind && d.open) d.close();
  }, [kind]);

  const pack = me?.pack;
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
            {t(kind === 'signIn' ? 'offer.signIn.title' : 'offer.out.title')}
          </h2>
          <p className="end-text">{t(kind === 'signIn' ? 'offer.signIn.body' : 'offer.out.body')}</p>
          <div className="offer-actions">
            {kind === 'signIn' &&
              me?.signIn.map((p) => (
                <a key={p} className="btn btn-ink" href={signInUrl(p)}>
                  {t(p === 'google' ? 'start.signIn.google' : 'start.signIn.github')}
                </a>
              ))}
            {kind === 'out' && pack && (
              <button type="button" className="btn btn-ink" disabled={buying} onClick={onBuy}>
                {t('offer.buy', { count: pack.shifts, price: pack.price })}
              </button>
            )}
            <button type="button" className="btn" onClick={onOwnKey}>
              {t('offer.ownKey')}
            </button>
            {kind === 'out' && sourceUrl && (
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
