import { dollars } from '../api/account';
import type { Usage } from '../api/account';
import { t } from '../i18n';

/** "62% of your usage left" over a slim bar; the dollars are in the small print and the tooltip. */
export function UsageMeter({ usage, note, className }: { usage: Usage; note?: boolean; className?: string }) {
  const share = usage.of > 0 ? Math.min(1, Math.max(0, usage.left / usage.of)) : 0;
  // Never "0%" while something is left, nor "100%" once something was used.
  const percent = usage.left <= 0 ? 0 : Math.min(usage.left < usage.of ? 99 : 100, Math.max(1, Math.round(share * 100)));
  const detail = t('usage.detail', { left: dollars(usage.left), of: dollars(usage.of) });
  return (
    <div className={`usage${percent <= 10 ? ' usage-low' : ''}${className ? ` ${className}` : ''}`} title={detail}>
      <div className="usage-line">
        <span>{t('usage.left', { percent })}</span>
        <span className="usage-dollars">{detail}</span>
      </div>
      <div className="usage-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('usage.left', { percent })}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      {note && <p className="usage-note">{t(usage.topUp ? 'usage.all' : 'usage.starter')}</p>}
    </div>
  );
}

/** The top-up buttons, smallest first. */
export function TopUps({ amounts, busy, onTopUp }: { amounts: number[]; busy: boolean; onTopUp(amount: number): void }) {
  if (!amounts.length) return null;
  return (
    <div className="topups">
      {amounts.map((a) => (
        <button key={a} type="button" className="btn btn-ink" disabled={busy} onClick={() => onTopUp(a)}>
          {t('limit.topUp', { amount: `$${a}` })}
        </button>
      ))}
    </div>
  );
}
