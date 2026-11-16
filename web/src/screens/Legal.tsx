import { t } from '../i18n';

// /privacy and /terms. English only: they describe what the server does, and a translation that
// drifts would be the wrong kind of promise. Keep them in step with server/src (accounts, sessions,
// stats, freemius).

const FREEMIUS_PRIVACY = 'https://freemius.com/privacy/';
const SOURCE = 'https://github.com/gulivan/worker755';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="about" lang="en">
      <article className="about-sheet">
        <a className="about-back" href="/">
          {t('about.back')}
        </a>
        <h1>{title}</h1>
        <p className="legal-date">Last updated 16 November 2026</p>
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
        sign-in, how many shifts you have left, and the license numbers of packs you bought. One cookie keeps you signed
        in for up to 180 days; signing out removes it. We ask Google and GitHub for nothing else.
      </p>

      <h2>When you pay</h2>
      <p>
        Packs are sold by Freemius, our merchant of record. They take your payment details, charge tax and send the
        receipt; we never see your card. Freemius tells us which license was bought and the buyer&apos;s email, so the
        shifts reach your account. See <a href={FREEMIUS_PRIVACY}>Freemius&apos;s privacy policy</a>.
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

      <h2>Where and how long</h2>
      <p>
        The server is in Germany. Accounts are kept until you ask us to delete yours; daily counts are kept without
        anything that identifies you. To see or delete your data, write to the address on your receipt, or open an
        issue at <a href={SOURCE}>{SOURCE.replace('https://', '')}</a> without personal details and we will reach you.
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

      <h2>Shifts</h2>
      <p>
        Signing in gives you one free shift. More shifts come in packs, paid once; nothing renews. A shift is used when it
        starts. If the manager fails before the first task is done, the shift is given back on its own. Bought shifts do
        not expire. With your own API key, or running the game yourself, you play without shifts.
      </p>

      <h2>Refunds</h2>
      <p>
        Freemius sells the packs and handles refunds. Ask within 14 days of buying and we refund a pack whose shifts you
        have not used. A refunded pack&apos;s shifts are taken back.
      </p>

      <h2>Fair use</h2>
      <p>
        Play as a person. Do not automate shifts, attack the server, or try to use the manager for anything other than
        the game. We may stop an account that does, and refund its unused packs.
      </p>

      <h2>No guarantees</h2>
      <p>
        The game is provided as it is. It may be down, change, or end. If it ends, we refund unused shifts bought in the
        last 12 months. Our liability is limited to what you paid us in the last 12 months.
      </p>
    </Page>
  );
}
