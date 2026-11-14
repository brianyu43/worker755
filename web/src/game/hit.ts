import { currentLanguage } from '../i18n';
import { touchOnly } from './keys';

/** Counts this page load on the server: path, where the visitor came from, language and device. No cookies. */
export function countVisit(): void {
  const q = new URLSearchParams(location.search);
  if (q.has('mock')) return;
  const body = JSON.stringify({
    path: location.pathname,
    ref: document.referrer,
    source: q.get('utm_source') ?? q.get('ref') ?? '',
    lang: currentLanguage(),
    mobile: touchOnly(),
  });
  try {
    if (!navigator.sendBeacon?.('/api/hit', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/hit', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* counting is best effort */
  }
}
