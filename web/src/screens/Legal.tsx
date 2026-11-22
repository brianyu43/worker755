import { t } from '../i18n';

// /privacy and /terms. English only: they describe what the server does, and a translation that
// drifts would be the wrong kind of promise. Keep them in step with server/src (accounts, sessions,
// stats, freemius).

const FREEMIUS_PRIVACY = 'https://freemius.com/privacy/';
const SUPPORT = 'support@worker755.com';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="about" lang="en">
      <article className="about-sheet">
        <a className="about-back" href="/">
          {t('about.back')}
        </a>
        <h1>{title}</h1>
        <p className="legal-date">Last updated 22 November 2026</p>
        {children}
      </article>
    </main>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy">
      <h2>When you sign in</h2>
      <p>
        You sign in with Google or GitHub. We keep the name and verified email address they give us, an id for that
        sign-in, your usage balance, and the license numbers and amounts of the top-ups you bought. One cookie keeps
        you signed in for up to 180 days; signing out removes it. We ask Google and GitHub for nothing else.
      </p>

      <h2>When you pay</h2>
      <p>
        Top-ups are sold by Freemius, our merchant of record. They take your payment details, charge tax and send the
        receipt; we never see your card. Freemius tells us which license was bought and the buyer&apos;s email, so the
        credit reaches your account. See <a href={FREEMIUS_PRIVACY}>Freemius&apos;s privacy policy</a>.
      </p>

      <h2>When you play</h2>
      <p>
        A shift&apos;s files, commands and messages stay in the server&apos;s memory while the shift runs and are dropped
        when it ends, at the latest after four hours. The manager is an AI model: what you report and what your commands
        print is sent to the model&apos;s provider through Vercel AI Gateway, or through the provider of the API key you
        bring. Your own key is used for that shift only and is not stored on the server; if you ask the page to
        remember it, it is kept in your browser.
      </p>
      <p>A review you share is public to anyone with its link.</p>

      <h2>Counting visits</h2>
      <p>
        We count page views, where visitors come from and how shifts go, per day. A visitor is counted by a scrambled
        value of their address and browser that is forgotten each day. There are no ads and no tracking cookies.
      </p>
      <p>
        When a shift ends we keep a short anonymous summary of it: the manager model and settings, and for each task
        whether the work was really done, whether the manager approved it, and how many times it checked. It holds no
        files, commands, messages, names, addresses or account ids. We use it to compare how the models judge work.
      </p>

      <h2>Where and how long</h2>
      <p>
        The server is in Germany. Accounts are kept until you ask us to delete yours; daily counts and shift summaries are kept without
        anything that identifies you. To see or delete your data, write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
      </p>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms">
      <h2>The game</h2>
      <p>
        Worker 755 is a game. The manager is an AI model playing a character, and some characters are rude on purpose;
        nothing it says is about you. The workplace is a sandbox in your browser: nothing you run there touches a real
        system.
      </p>

      <h2>Usage</h2>
      <p>
        Shifts on our models use credit from your account, in US dollars. Signing in gives you a one-time starter credit,
        about one shift on the default model; it is not refilled. Each call to a model takes twice what the model&apos;s
        provider charges us for it, so larger models use credit faster. When the credit runs out during a shift, the
        shift pauses: you can top up and go on, go on with your own API key, or end it and get your review.
      </p>
      <p>
        Top-ups of $10, $20, $50 and $200 are paid once; nothing renews. Credit does not expire. With your own API key, or
        running the game yourself, you play without credit.
      </p>

      <h2>Refunds</h2>
      <p>
        Freemius sells the top-ups and handles refunds. Ask within 14 days of buying, at{' '}
        <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> or through your receipt, and we refund the credit of that top-up you
        have not used. A refunded top-up&apos;s credit is taken back.
      </p>

      <h2>Fair use</h2>
      <p>
        Play as a person. Do not automate shifts, attack the server, or try to use the manager for anything other than
        the game. We may stop an account that does, and refund its unused credit.
      </p>

      <h2>No guarantees</h2>
      <p>
        The game is provided as it is. It may be down, change, or end. If it ends, we refund unused credit bought in the
        last 12 months. Our liability is limited to what you paid us in the last 12 months.
      </p>
    </Page>
  );
}
