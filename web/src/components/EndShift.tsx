import { useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import { t } from '../i18n';

interface Props {
  sessionId: string;
  open: boolean;
  onClose(): void;
}

/** Asks before ending the shift early. Once ended, the manager writes the review from what was done so far. */
export function EndShift({ sessionId, open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const end = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.finishShift(sessionId);
      onClose();
    } catch (err) {
      // Already over: the review is on its way anyway.
      if (err instanceof ApiError && err.status === 409) onClose();
      else setError(t('pause.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="end-dialog"
      aria-labelledby="end-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="end-sheet">
        <h2 className="end-title" id="end-title">
          {t('end.title')}
        </h2>
        <p className="end-text">{t('end.body')}</p>
        <div className="end-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy} autoFocus>
            {t('end.cancel')}
          </button>
          <button type="button" className="btn btn-stamp" onClick={() => void end()} disabled={busy}>
            {busy ? t('pause.ending') : t('pause.finish')}
          </button>
        </div>
        {error && <p className="form-error end-error">{error}</p>}
      </div>
    </dialog>
  );
}
