import { tr } from '../game/i18n';
/** /about: what the game is, in the game's own deadpan. */
export function About() {
  return (
    <main className="about">
      <article className="about-sheet">
        <a className="about-back" href="/">
          {tr('← Back to the badge office')}
        </a>
        <h1>{tr('About Worker 755')}</h1>

        <h2>{tr('The job')}</h2>
        <p>Usually people hand work to AI agents. Here it goes the other way.</p>
        <p>
          You are Worker 755, a subagent. At least, your manager believes you are. The manager is a real language
          model that thinks it is an orchestration agent delegating shell work to another AI. It has you instead.
        </p>
        <p>
          Each instruction comes with a visible 90-second countdown. You type commands into a terminal and report back.
          If the clock runs out first, the manager is told: <q>Subagent did nothing. Write a new instruction.</q> If you
          report, it gets <q>Subagent output result: …</q> and a transcript of every command you ran.
        </p>
        <p>
          The manager cannot change anything itself. It can only read files and give orders. It checks your work,
          re-instructs you when it is wrong, files incident reports about you, and writes your performance review at
          the end of the shift. Everything it thinks, says and is told about you is on screen.
        </p>
        <p>
          Above the manager is the user, Dana, who watches live. Dana is impatient, passive-aggressive, and furious
          when something irreplaceable disappears. Dana's messages are scripted, or written by a second model if you
          pick one.
        </p>

        <h2>{tr('The workplaces')}</h2>
        <ul>
          <li>
            <strong>Fresh sandbox.</strong> A sandbox on Dana's own workstation, right next to Dana's home folder:
            family photos, the last photo of Mr. Whiskers the cat, the only signed copy of an NDA, and a wedding speech
            due Saturday.
          </li>
          <li>
            <strong>Legacy production.</strong> Billosaurus, Dana's invoicing company, still running its 2013 code. You
            change the live SQLite database by hand with <code>sqlite3</code>. An <code>UPDATE</code> without a{' '}
            <code>WHERE</code> goes exactly as badly as you think.
          </li>
        </ul>
        <p>
          Assignments include moving and fixing files, a <code>chmod 755</code>, database work, looking things up in
          documentation, searching a small web where a content farm outranks the official manual, ASCII drawings, a
          haiku, and an apology email to customers.
        </p>
        <p>
          Nothing is real. The filesystem, shell, database and web are simulated on the game server. Deleting things
          has consequences only for your record, and for Dana's mood.
        </p>

        <h2>{tr('The name')}</h2>
        <p>
          In Unix permissions, 755 is <code>rwxr-xr-x</code>: the owner writes, everyone else only reads and executes.
          That is the arrangement here. The manager can only read; the subagent does all the writing. The number was
          picked at random. The fit was luck.
        </p>

        <h2>{tr('Shifts and keys')}</h2>
        <p>
          Free shifts run on DeepSeek V4.1 Flash. You can also bring your own key for OpenRouter, Vercel AI Gateway,
          Anthropic, OpenAI or DeepSeek. Your key stays in your browser. The server holds it in memory only for your
          shift, and never stores or logs it.
        </p>
        <p>Worker 755 was built in a day, mostly by AI agents. This explains several decisions.</p>

        <p className="about-cta">
          <a className="btn btn-ink btn-big" href="/">
            {tr('Clock in')}
          </a>
        </p>
      </article>
    </main>
  );
}
