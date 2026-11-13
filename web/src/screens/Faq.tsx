import { useEffect } from 'react';
import { currentLanguage, t } from '../i18n';
import { markup } from '../i18n/rich';
import { faqFor } from '../faq';

/** Opens the question named in the address (/faq#key) and brings it into view. */
function openFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const item = id ? document.getElementById(id) : null;
  if (!(item instanceof HTMLDetailsElement)) return;
  item.open = true;
  item.scrollIntoView({ block: 'start' });
  item.querySelector('summary')?.focus({ preventScroll: true });
}

/** /faq: what players ask. Each question is a <details> whose id is its anchor. */
export function Faq() {
  const faq = faqFor(currentLanguage());

  useEffect(() => {
    const title = document.title;
    document.title = `${t('faq.title')} · Worker 755`;
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.removeEventListener('hashchange', openFromHash);
      document.title = title;
    };
  }, []);

  /** The address follows the open question, so it can be copied as a link to it. */
  const follow = (id: string, open: boolean) => {
    const here = window.location.hash.slice(1);
    if (open && here !== id) history.replaceState(null, '', `#${id}`);
    else if (!open && here === id) history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  return (
    <main className="about">
      <article className="about-sheet faq-sheet">
        <a className="about-back" href="/">
          {t('about.back')}
        </a>
        <h1>{t('faq.title')}</h1>
        <p className="faq-lede">{faq.lede}</p>

        {faq.sections.map((section) => (
          <section key={section.title} className="faq-section">
            <h2>{section.title}</h2>
            {section.items.map((item) => (
              <details key={item.id} id={item.id} className="faq-item" onToggle={(e) => follow(item.id, e.currentTarget.open)}>
                <summary>{item.q}</summary>
                <div className="faq-answer">
                  {item.a.split(/\n{2,}/).map((p, i) => (
                    <p key={i}>{markup(p)}</p>
                  ))}
                </div>
              </details>
            ))}
          </section>
        ))}

        <p className="about-cta">
          <a className="btn btn-ink btn-big" href="/">
            {t('start.clockIn')}
          </a>
        </p>
      </article>
    </main>
  );
}
