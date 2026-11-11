import { t } from '../i18n';
import { rich } from '../i18n/rich';

/** /about: what the game is, in the game's own deadpan. */
export function About() {
  return (
    <main className="about">
      <article className="about-sheet">
        <a className="about-back" href="/">
          {t('about.back')}
        </a>
        <h1>{t('about.title')}</h1>

        <h2>{t('about.job')}</h2>
        <p>{rich('about.job.1')}</p>
        <p>{rich('about.job.2')}</p>
        <p>{rich('about.job.3')}</p>
        <p>{rich('about.job.4')}</p>
        <p>{rich('about.job.5')}</p>

        <h2>{t('about.workplaces')}</h2>
        <ul>
          <li>{rich('about.workplaces.fresh')}</li>
          <li>{rich('about.workplaces.legacy')}</li>
        </ul>
        <p>{rich('about.workplaces.tasks')}</p>
        <p>{rich('about.workplaces.simulated')}</p>

        <h2>{t('about.name')}</h2>
        <p>{rich('about.name.1')}</p>

        <h2>{t('about.keys')}</h2>
        <p>{rich('about.keys.1')}</p>
        <p>{rich('about.keys.2')}</p>

        <p className="about-cta">
          <a className="btn btn-ink btn-big" href="/">
            {t('start.clockIn')}
          </a>
        </p>
      </article>
    </main>
  );
}
