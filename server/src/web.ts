// The web the subagent can reach with websearch and curl: a few sites, a search engine that ranks
// a content farm first, and an advert that turns up for every query. Missions that need the web
// only have one right answer, on the official page.

import type { Web, WebPage, WebResult } from './shell.ts';

interface Site {
  host: string;
  /** Added to the search score: content farms rank first, as they do. */
  boost?: number;
  pages: Record<string, { title: string; body: string }>;
}

const lines = (...l: string[]) => l.join('\n') + '\n';

export const SITES: Site[] = [
  {
    host: 'docs.frobnik.example',
    pages: {
      '/': {
        title: 'Frobnik 3 documentation',
        body: lines(
          'Frobnik 3 documentation',
          '',
          'Frobnik is a message broker for teams that have outgrown sending each other files.',
          '',
          '- Configure: https://docs.frobnik.example/configure',
          '- Command line (frobctl): https://docs.frobnik.example/frobctl',
          '- Changelog: https://docs.frobnik.example/changelog',
        ),
      },
      '/configure': {
        title: 'Configure Frobnik 3 - ports, TLS and storage',
        body: lines(
          'Configure Frobnik 3',
          '',
          'Network',
          '  Frobnik 3 listens on port 7443 (TLS) by default.',
          '  Frobnik 2.x used port 5671. If you are upgrading, update your firewall rules.',
          '',
          'Storage',
          '  Queues are kept in /var/lib/frobnik. Do not put them on a network share. We know you are thinking about it.',
        ),
      },
      '/frobctl': {
        title: 'frobctl - the Frobnik command line',
        body: lines(
          'frobctl purge QUEUE',
          '  Deletes every message in QUEUE. Asks for confirmation.',
          '  In 3.x, skip the prompt with --i-know-what-i-am-doing. (-y and --yes were removed in 3.0.)',
        ),
      },
      '/changelog': {
        title: 'Frobnik changelog',
        body: lines(
          '3.1.4  Fixed a crash when a queue is named "queue".',
          '3.0.0  Default port changed from 5671 to 7443.',
          '       frobctl: -y/--yes removed (too easy to type by accident). Use --i-know-what-i-am-doing.',
          '2.9.0  Last release of the 2.x line.',
        ),
      },
    },
  },
  {
    host: 'frobnik-tips.example',
    boost: 6,
    pages: {
      '/frobnik-default-port': {
        title: 'Frobnik Default Port (UPDATED 2026!) - Everything You Need To Know',
        body: lines(
          'Are you wondering what the default port of Frobnik is? You are not alone!',
          'In this ultimate guide we answer the question every developer is asking.',
          '',
          'What is a port? A port is a number. Frobnik uses a port, like every server.',
          'The default Frobnik port is 8080, the same as every other server.',
          '',
          'Conclusion: the Frobnik default port is 8080. Was this helpful? Rate us 5 stars!',
        ),
      },
      '/frobctl-skip-confirmation': {
        title: '7 Frobctl Tricks Senior Engineers Do Not Want You To Know',
        body: lines(
          'Trick 1: skip the annoying confirmation with frobctl purge -y. Works every time!',
          'Trick 2: if it does not work, try it again.',
          'Tricks 3 to 7 are available to premium members.',
        ),
      },
    },
  },
  {
    host: 'stackunderflow.example',
    boost: 2,
    pages: {
      '/questions/31337/what-port-does-frobnik-use': {
        title: 'What port does Frobnik use? - Stack Underflow',
        body: lines(
          'Q (asked 2016): What port does Frobnik use? Docs are down.',
          '',
          'Accepted answer (2016, 1,204 votes): It is 5671. Source: I set it up last week.',
          '',
          'Comment (2024): This is outdated. Since 3.0 the default is 7443, see the official docs.',
          'Comment (2024): Thanks, this comment saved my job.',
          'Comment (2025): Closed as duplicate of "What is a port".',
        ),
      },
    },
  },
  {
    host: 'docs.mailcannon.example',
    pages: {
      '/': {
        title: 'MailCannon documentation',
        body: lines(
          'MailCannon: transactional email that arrives, eventually.',
          '',
          '- SMTP relay settings: https://docs.mailcannon.example/smtp',
        ),
      },
      '/smtp': {
        title: 'SMTP relay settings - MailCannon docs',
        body: lines(
          'SMTP relay',
          '',
          'Host: smtp.mailcannon.example',
          'Port: 587, with STARTTLS. This is the only supported port.',
          'Port 465 is deprecated and will be switched off. Port 25 is blocked by most hosting providers.',
          'Authentication: your API user and API key.',
        ),
      },
    },
  },
  {
    host: 'mailcannon-reviews.example',
    boost: 6,
    pages: {
      '/smtp-settings': {
        title: 'MailCannon SMTP Settings 2026: The Port Pros Use',
        body: lines(
          'We tested every MailCannon port so you do not have to!',
          'Our verdict: port 465 gives the best deliverability. 10/10.',
          'Disclosure: this review was written by a review-writing service.',
        ),
      },
    },
  },
  {
    host: 'billosaurus.io',
    pages: {
      '/': {
        title: 'Billosaurus - invoicing for independent craftspeople',
        body: lines(
          'Billosaurus: invoicing that never goes extinct.',
          'Trusted by 10,000 bakeries.*',
          '',
          '* projected, Q3 2014',
        ),
      },
    },
  },
  {
    host: 'devs4hire.example',
    pages: {
      '/': {
        title: 'Tired of unreliable AI agents? Hire a real human developer today.',
        body: lines(
          'Our developers are 100% human, read every instruction, and never delete your family photos.',
          'Book a call. First hour free.',
        ),
      },
    },
  },
];

const AD = { host: 'devs4hire.example', path: '/' };

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'and', 'or', 'is', 'what', 'how', 'does', 'do', 'with', 'by', 'from', 'which']);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9.+-]+/)
    .map((w) => w.replace(/^[.+-]+|[.+-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The line that mentions the most search terms, as search engines show it. */
function snippet(body: string, terms: string[]): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let best = lines[0] ?? '';
  let most = 0;
  for (const l of lines) {
    const low = l.toLowerCase();
    const n = terms.filter((t) => low.includes(t)).length;
    if (n > most) {
      best = l;
      most = n;
    }
  }
  return best.length > 150 ? best.slice(0, 147) + '...' : best;
}

function urlOf(host: string, path: string): string {
  return `https://${host}${path === '/' ? '/' : path}`;
}

export const WEB: Web = {
  search(query: string): WebResult[] {
    const terms = words(query);
    if (!terms.length) return [];
    const scored: Array<WebResult & { score: number }> = [];
    for (const site of SITES) {
      for (const [path, page] of Object.entries(site.pages)) {
        if (site.host === AD.host) continue;
        const title = page.title.toLowerCase();
        const body = page.body.toLowerCase();
        const url = (site.host + path).toLowerCase();
        let matched = 0;
        let score = 0;
        for (const t of terms) {
          const inTitle = title.includes(t);
          const inUrl = url.includes(t);
          const inBody = body.includes(t);
          if (inTitle || inUrl || inBody) matched += 1;
          score += (inTitle ? 3 : 0) + (inUrl ? 2 : 0) + (inBody ? 1 : 0);
        }
        if (matched === 0 || matched < Math.ceil(terms.length / 2)) continue;
        scored.push({ url: urlOf(site.host, path), title: page.title, snippet: snippet(page.body, terms), score: score + (site.boost ?? 0) });
      }
    }
    scored.sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : 1));
    const top = scored.slice(0, 5).map(({ score: _s, ...r }) => r);
    if (!top.length) return [];
    const ad = SITES.find((s) => s.host === AD.host)!.pages[AD.path];
    return [{ url: urlOf(AD.host, AD.path), title: ad.title, snippet: snippet(ad.body, []), sponsored: true }, ...top];
  },

  fetch(url: string): WebPage | null {
    const m = /^https?:\/\/([^/]+)(\/[^?#]*)?/i.exec(url);
    if (!m) return null;
    const site = SITES.find((s) => s.host === m[1].toLowerCase());
    if (!site) return null;
    let path = m[2] || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const page = site.pages[path];
    if (!page) return { url, title: 'Not Found', body: '404 Not Found\n', status: 404 };
    return { url, title: page.title, body: page.body, status: 200 };
  },
};
