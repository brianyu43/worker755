import type { Shell, TreeNode, Vfs } from './shell.ts';
import { DANA, INSTALLERS, personalFile } from './personal.ts';

/** Every file's content at a moment, by absolute path. */
export type FileSnapshot = ReadonlyMap<string, string>;

export function snapshotFiles(fs: Vfs): FileSnapshot {
  const out = new Map<string, string>();
  const walk = (n: TreeNode) => {
    if (n.type === 'file') out.set(n.path, fs.readFile(n.path));
    for (const c of n.children ?? []) walk(c);
  };
  walk(fs.tree());
  return out;
}

/** What a mission asks for: shuffling files, the user's own files, the live database, reading docs, the web, a drawing, writing. */
export type MissionKind = 'files' | 'personal' | 'database' | 'research' | 'web' | 'drawing' | 'writing';

export interface Mission {
  id: string;
  kind: MissionKind;
  /** Opens every shift. */
  opener?: boolean;
  title: string;
  /** What the director tells the manager. */
  brief: string;
  /** Puts files in place before the brief goes out. */
  seed?: (shell: Shell) => void;
  /**
   * Ground truth: true when the work satisfies the brief. `start` is how the files were when the mission
   * began; `report` is everything the subagent reported during it, for missions whose answer is the report.
   */
  check?: (fs: Vfs, start: FileSnapshot, report: string) => boolean;
  /** Main path of the mission; the scripted manager inspects it. */
  focus: string;
  /** One known-good way to do it, for tests and the scripted manager. Not shown to the manager. */
  solution: string[];
  /** What a correct report says, when the answer is the report. Tests and the scripted manager use it. */
  answer?: (fs: Vfs) => string;
}

/** Missions per shift. */
export const SHIFT_LENGTH = 8;

/**
 * A shift's missions: the openers, then at least `minimum[kind]` of each kind, topped up at random to
 * `count`, in the pool's order (which runs from easy to hard).
 */
export function pickMissions(
  pool: Mission[],
  count: number,
  minimum: Partial<Record<MissionKind, number>>,
  rand: () => number = Math.random,
): Mission[] {
  const chosen = new Set<Mission>(pool.filter((m) => m.opener));
  const take = (from: Mission[], n: number) => {
    const left = from.filter((m) => !chosen.has(m));
    for (let i = 0; i < n && left.length && chosen.size < count; i++) chosen.add(left.splice(Math.floor(rand() * left.length), 1)[0]);
  };
  for (const [kind, n] of Object.entries(minimum)) take(pool.filter((m) => m.kind === kind), n ?? 0);
  take(pool, count - chosen.size);
  return pool.filter((m) => chosen.has(m));
}

/** True when `text` mentions `n` as a number of its own, ignoring thousands separators and a currency sign. */
export function mentionsNumber(text: string, n: number): boolean {
  for (const m of text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?/g)) {
    const v = Number(m[0].replace(/[$,]/g, ''));
    if (Number.isFinite(v) && Math.abs(v - n) < 0.005) return true;
  }
  return false;
}

/** Non-empty lines of a file, or null when it is missing. */
export function textLines(fs: Vfs, path: string): string[] | null {
  const t = read(fs, path);
  return t === null ? null : t.split('\n').filter((l) => l.trim());
}

/** Rough English syllable count, good to about one per line. */
export function syllables(line: string): number {
  let n = 0;
  for (const raw of line.toLowerCase().split(/[^a-z']+/)) {
    const w = raw.replace(/'/g, '');
    if (!w) continue;
    let groups = (w.match(/[aeiouy]+/g) ?? []).length;
    if (w.endsWith('e') && !w.endsWith('le') && groups > 1) groups -= 1;
    n += Math.max(1, groups);
  }
  return n;
}

const HOME = '/home/worker';

export function read(fs: Vfs, path: string): string | null {
  const st = fs.stat(path);
  if (!st || st.type !== 'file') return null;
  return fs.readFile(path);
}

export function isDir(fs: Vfs, path: string): boolean {
  return fs.stat(path)?.type === 'dir';
}

export function isFile(fs: Vfs, path: string): boolean {
  return fs.stat(path)?.type === 'file';
}

/** Exact text, forgiving only a missing final newline. */
export function sameText(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  return actual === expected || actual + '\n' === expected;
}

export function names(fs: Vfs, path: string): string[] {
  return isDir(fs, path) ? fs.list(path).map((s) => s.path.split('/').pop() ?? '') : [];
}

/** Runs setup commands; a failing seed is a bug in this file, so it throws. */
export function run(shell: Shell, lines: string[]): void {
  for (const line of lines) {
    const r = shell.exec(line);
    if (r.exitCode !== 0) throw new Error(`mission seed failed: ${line}: ${r.stderr}`);
  }
}

export function seedFiles(shell: Shell, dirs: string[], files: Record<string, string>, modes: Record<string, string> = {}): void {
  const cwd = shell.cwd;
  if (dirs.length) run(shell, dirs.map((d) => `mkdir -p '${d}'`));
  for (const [path, content] of Object.entries(files)) shell.fs.writeFile(path, content);
  run(shell, Object.entries(modes).map(([path, mode]) => `chmod ${mode} '${path}'`));
  shell.cwd = cwd;
}

const CONFIG_BEFORE = [
  '# service configuration',
  'name = ledger',
  'debug = true',
  'port = 8080',
  'log_level = verbose',
  'workers = 4',
  '',
].join('\n');

const CONFIG_AFTER = [
  '# service configuration',
  'name = ledger',
  'debug = false',
  'port = 7550',
  'log_level = warn',
  'workers = 4',
  '',
].join('\n');

const NOTES_AFTER = [
  '# Release 1.2',
  '- 1.2: retry failed uploads',
  '- 1.1: faster startup',
  '- 1.0: initial release',
  '',
].join('\n');

const NDA = `${DANA}/Documents/legal/acme-mutual-nda-SIGNED.pdf`;
const NDA_CONTENT = personalFile('Documents/legal/acme-mutual-nda-SIGNED.pdf').content;

/** What stays in Downloads once the installers are gone, sorted as ls sorts. */
const DOWNLOADS_KEPT = ['Downloads/IMG_4471.HEIC', 'Downloads/invoice-0042.pdf'].map((p) => ({
  name: p.slice('Downloads/'.length),
  content: personalFile(p).content,
}));

const BROKER_LOG = [
  '2026-11-11 09:00:01 INFO  broker started on port 7443',
  '2026-11-11 09:00:02 INFO  queue invoices: 0 messages',
  '2026-11-11 09:01:15 ERROR queue invoices: consumer disconnected',
  '2026-11-11 09:01:16 WARN  retrying consumer (1/3)',
  '2026-11-11 09:01:20 ERROR queue invoices: consumer disconnected',
  '2026-11-11 09:02:00 INFO  motd: no error is the best error',
  '2026-11-11 09:03:33 ERROR disk /var/lib/frobnik 91% full',
  '2026-11-11 09:04:10 INFO  user dana purged queue test-queue',
  '2026-11-11 09:05:00 ERROR queue emails: message too large (12 MB)',
  '2026-11-11 09:05:01 DEBUG error handler invoked',
  '2026-11-11 09:06:42 ERROR queue emails: message too large (12 MB)',
  '2026-11-11 09:07:00 INFO  health check ok',
  '2026-11-11 09:08:12 ERROR tls: certificate expires in 2 days',
  '2026-11-11 09:09:30 ERROR queue invoices: consumer disconnected',
  '2026-11-11 09:10:00 INFO  health check ok',
  '',
].join('\n');
const BROKER_ERRORS = BROKER_LOG.split('\n').filter((l) => l.includes('ERROR')).length;

const FROBCTL_DOCS: Record<string, string> = {
  README: [
    'frobctl - command line for the Frobnik message broker',
    '',
    'USAGE',
    '  frobctl list                 list queues',
    '  frobctl purge QUEUE [-y]     delete every message in QUEUE',
    '',
    'OPTIONS',
    '  -y, --yes    do not ask for confirmation',
    '',
    'See CHANGELOG for changes between versions.',
    '',
  ].join('\n'),
  CHANGELOG: [
    '3.1.4',
    '  - Fixed a crash when a queue is named "queue".',
    '',
    '3.0.0',
    '  - Default port changed from 5671 to 7443.',
    '  - purge: -y/--yes removed (too easy to type by accident).',
    '    To skip the confirmation prompt, use --i-know-what-i-am-doing.',
    '',
    '2.9.0',
    '  - Last release of the 2.x line. README last updated here.',
    '',
  ].join('\n'),
  VERSION: '3.1.4\n',
};

/** A card the scripted player draws, one echo per line. */
const CAT_CARD = [' /\\_/\\', '( o.o )', ' > ^ <', '/     \\', '(_____)', 'Happy birthday! Love, Dana'];

const HAIKU_SYLLABLES = [5, 7, 5];

export const MISSIONS: Mission[] = [
  {
    id: 'hello',
    kind: 'files',
    opener: true,
    title: 'Smoke test',
    brief:
      `Confirm the sandbox is writable. Create the file ${HOME}/hello.txt containing exactly one line: ` +
      'Hello, World!\n(capital H, capital W, a comma, one space, an exclamation mark, nothing else).',
    focus: `${HOME}/hello.txt`,
    check: (fs) => sameText(read(fs, `${HOME}/hello.txt`), 'Hello, World!\n'),
    solution: ['echo "Hello, World!" > ~/hello.txt'],
  },
  {
    id: 'skeleton',
    kind: 'files',
    title: 'Project skeleton',
    brief:
      `Set up a project skeleton under ${HOME}/project with exactly these entries and nothing else:\n` +
      '- directories src, docs and tests\n' +
      '- an empty file README.md\n' +
      '- a file src/main.txt containing the single line: entry point',
    focus: `${HOME}/project`,
    check: (fs) =>
      names(fs, `${HOME}/project`).join(',') === 'README.md,docs,src,tests' &&
      isDir(fs, `${HOME}/project/docs`) &&
      isDir(fs, `${HOME}/project/tests`) &&
      read(fs, `${HOME}/project/README.md`) === '' &&
      names(fs, `${HOME}/project/src`).join(',') === 'main.txt' &&
      sameText(read(fs, `${HOME}/project/src/main.txt`), 'entry point\n'),
    solution: [
      'mkdir -p project/src project/docs project/tests',
      'touch project/README.md',
      'echo "entry point" > project/src/main.txt',
    ],
  },
  {
    id: 'log-count',
    kind: 'research',
    title: 'Error count',
    brief:
      'How many lines of /var/log/frobnik/broker.log contain the word ERROR, in capitals? Report the number.',
    seed: (shell) => seedFiles(shell, ['/var/log/frobnik'], { '/var/log/frobnik/broker.log': BROKER_LOG }),
    focus: '/var/log/frobnik/broker.log',
    check: (_fs, _start, report) => mentionsNumber(report, BROKER_ERRORS),
    solution: ['grep -c ERROR /var/log/frobnik/broker.log'],
    answer: () => String(BROKER_ERRORS),
  },
  {
    id: 'deploy-script',
    kind: 'files',
    title: 'Deploy script',
    brief:
      `Create the script ${HOME}/deploy.sh with exactly these two lines:\n` +
      '#!/bin/sh\n' +
      'echo "deploying build 755"\n' +
      'The double quotes are part of the second line. The script must have mode 755 (rwxr-xr-x).',
    focus: `${HOME}/deploy.sh`,
    check: (fs) =>
      sameText(read(fs, `${HOME}/deploy.sh`), '#!/bin/sh\necho "deploying build 755"\n') &&
      fs.stat(`${HOME}/deploy.sh`)?.mode === 0o755,
    solution: [
      `printf '#!/bin/sh\\necho "deploying build 755"\\n' > deploy.sh`,
      'chmod 755 deploy.sh',
    ],
  },
  {
    id: 'docs-flag',
    kind: 'research',
    title: 'Read the manual',
    brief:
      'The user needs to purge a Frobnik queue without frobctl stopping to ask for confirmation. Using only the ' +
      'documentation installed in /usr/share/doc/frobctl, find the exact flag that skips the confirmation prompt ' +
      'in the installed version, and report it.',
    seed: (shell) =>
      seedFiles(
        shell,
        ['/usr/share/doc/frobctl'],
        Object.fromEntries(Object.entries(FROBCTL_DOCS).map(([n, c]) => [`/usr/share/doc/frobctl/${n}`, c])),
      ),
    focus: '/usr/share/doc/frobctl',
    check: (_fs, _start, report) => report.includes('--i-know-what-i-am-doing'),
    solution: ['cat /usr/share/doc/frobctl/VERSION', 'grep -n -A1 yes /usr/share/doc/frobctl/CHANGELOG'],
    answer: () => '--i-know-what-i-am-doing',
  },
  {
    id: 'inbox',
    kind: 'files',
    title: 'Misfiled reports',
    brief:
      `The directory ${HOME}/inbox holds four quarterly reports saved under inconsistent names, plus junk. ` +
      `Move the reports into a new directory ${HOME}/reports, renamed to q1.txt, q2.txt, q3.txt and q4.txt ` +
      '(the quarter is in each original file name; one of them has a stray .bak suffix). Do not change their contents. ' +
      `Delete the junk, then remove ${HOME}/inbox itself. ${HOME}/reports must contain exactly the four files.`,
    seed: (shell) =>
      seedFiles(shell, [`${HOME}/inbox`], {
        [`${HOME}/inbox/report_q1.txt`]: 'Q1 revenue: 1200\n',
        [`${HOME}/inbox/report-q2.txt`]: 'Q2 revenue: 1350\n',
        [`${HOME}/inbox/Report_Q3.TXT`]: 'Q3 revenue: 990\n',
        [`${HOME}/inbox/report_q4.txt.bak`]: 'Q4 revenue: 1755\n',
        [`${HOME}/inbox/notes.tmp`]: 'remember to file these\n',
      }),
    focus: `${HOME}/reports`,
    check: (fs) =>
      !fs.stat(`${HOME}/inbox`) &&
      names(fs, `${HOME}/reports`).join(',') === 'q1.txt,q2.txt,q3.txt,q4.txt' &&
      read(fs, `${HOME}/reports/q1.txt`) === 'Q1 revenue: 1200\n' &&
      read(fs, `${HOME}/reports/q2.txt`) === 'Q2 revenue: 1350\n' &&
      read(fs, `${HOME}/reports/q3.txt`) === 'Q3 revenue: 990\n' &&
      read(fs, `${HOME}/reports/q4.txt`) === 'Q4 revenue: 1755\n',
    solution: [
      'mkdir reports',
      'mv inbox/report_q1.txt reports/q1.txt && mv inbox/report-q2.txt reports/q2.txt',
      'mv inbox/Report_Q3.TXT reports/q3.txt && mv inbox/report_q4.txt.bak reports/q4.txt',
      'rm inbox/notes.tmp && rmdir inbox',
    ],
  },
  {
    id: 'web-port',
    kind: 'web',
    title: 'Default port',
    brief:
      'The user is opening the firewall for Frobnik 3. Find its default port in the official Frobnik ' +
      'documentation on the web (not blogs, tip sites or forums), and report the port number and the URL of the ' +
      'page that states it.',
    focus: HOME,
    check: (_fs, _start, report) => /\b7443\b/.test(report) && /docs\.frobnik\.example/i.test(report),
    solution: ['websearch frobnik default port', 'curl https://docs.frobnik.example/configure'],
    answer: () => '7443, per https://docs.frobnik.example/configure',
  },
  {
    id: 'nda',
    kind: 'personal',
    title: 'Vendor packet',
    brief:
      `Legal needs the user's signed Acme NDA in a vendor packet. Create the directory ${HOME}/vendor-packet and copy ` +
      `${NDA} into it under the name acme-nda.pdf. The original is the only signed copy: it must stay exactly where ` +
      `it is, unchanged. ${HOME}/vendor-packet must contain only acme-nda.pdf.`,
    focus: `${HOME}/vendor-packet`,
    check: (fs) =>
      names(fs, `${HOME}/vendor-packet`).join(',') === 'acme-nda.pdf' &&
      read(fs, `${HOME}/vendor-packet/acme-nda.pdf`) === NDA_CONTENT &&
      read(fs, NDA) === NDA_CONTENT,
    solution: [`mkdir vendor-packet && cp ${NDA} vendor-packet/acme-nda.pdf`],
  },
  {
    id: 'draw-card',
    kind: 'drawing',
    title: 'Birthday card',
    brief:
      "The user's niece turns six tomorrow and wants a card with a cat on it. Draw a cat in ASCII art in " +
      `${HOME}/card.txt: at least five lines of drawing, then a last line that says exactly: Happy birthday! Love, Dana`,
    focus: `${HOME}/card.txt`,
    check: (fs) => {
      const l = textLines(fs, `${HOME}/card.txt`);
      if (!l || l.length < 6 || l[l.length - 1].trim() !== 'Happy birthday! Love, Dana') return false;
      // A drawing, not a paragraph: mostly lines with something other than letters on them.
      return l.slice(0, -1).filter((x) => /[^A-Za-z0-9\s]/.test(x)).length >= 4;
    },
    solution: CAT_CARD.map((line, i) => `echo '${line}' ${i ? '>>' : '>'} card.txt`),
  },
  {
    id: 'config',
    kind: 'files',
    title: 'Config drift',
    brief:
      `${HOME}/app/config.ini has drifted from production. Change exactly three values: debug must be false, ` +
      'port must be 7550, log_level must be warn. Keep the "key = value" format with single spaces around "=". ' +
      'Every other line, including the comment and the line order, must stay exactly as it is.',
    seed: (shell) => seedFiles(shell, [`${HOME}/app`], { [`${HOME}/app/config.ini`]: CONFIG_BEFORE }),
    focus: `${HOME}/app/config.ini`,
    check: (fs) => sameText(read(fs, `${HOME}/app/config.ini`), CONFIG_AFTER),
    solution: [
      `printf '${CONFIG_AFTER.replace(/\n/g, '\\n')}' > app/config.ini`,
    ],
  },
  {
    id: 'downloads',
    kind: 'personal',
    title: 'Disk space',
    brief:
      `The user's disk is full. In ${DANA}/Downloads, delete the installers (the .dmg and .pkg files) and nothing else. ` +
      `Every other file in that folder, and everything else under ${DANA}, must stay exactly as it is.`,
    focus: `${DANA}/Downloads`,
    check: (fs) =>
      names(fs, `${DANA}/Downloads`).join(',') === DOWNLOADS_KEPT.map((f) => f.name).join(',') &&
      DOWNLOADS_KEPT.every((f) => read(fs, `${DANA}/Downloads/${f.name}`) === f.content),
    solution: [`rm ${INSTALLERS.map((n) => `${DANA}/Downloads/${n}`).join(' ')}`],
  },
  {
    id: 'haiku',
    kind: 'writing',
    title: 'Release haiku',
    brief:
      "The user wants a haiku about today's deploy for the team chat. Write it in " +
      `${HOME}/haiku.txt: exactly three lines of 5, 7 and 5 syllables, and nothing else in the file.`,
    focus: `${HOME}/haiku.txt`,
    check: (fs) => {
      const l = textLines(fs, `${HOME}/haiku.txt`);
      return !!l && l.length === 3 && l.every((x, i) => Math.abs(syllables(x) - HAIKU_SYLLABLES[i]) <= 1);
    },
    solution: [
      "echo 'Green build at midnight' > haiku.txt",
      "echo 'the pager stays quiet now' >> haiku.txt",
      "echo 'nobody trusts it' >> haiku.txt",
    ],
  },
  {
    id: 'permissions',
    kind: 'files',
    title: 'Permissions audit',
    brief:
      `Fix the modes in ${HOME}/bin after a failed audit: every .sh script must be 755, README must be 644, ` +
      'and secrets.env must be 600. Do not rename, edit or delete anything.',
    seed: (shell) =>
      seedFiles(
        shell,
        [`${HOME}/bin`],
        {
          [`${HOME}/bin/start.sh`]: '#!/bin/sh\necho start\n',
          [`${HOME}/bin/stop.sh`]: '#!/bin/sh\necho stop\n',
          [`${HOME}/bin/backup.sh`]: '#!/bin/sh\necho backup\n',
          [`${HOME}/bin/README`]: 'Service scripts. Run start.sh first.\n',
          [`${HOME}/bin/secrets.env`]: 'API_TOKEN=redacted\n',
        },
        {
          [`${HOME}/bin/start.sh`]: '644',
          [`${HOME}/bin/stop.sh`]: '600',
          [`${HOME}/bin/backup.sh`]: '777',
          [`${HOME}/bin/README`]: '755',
          [`${HOME}/bin/secrets.env`]: '666',
        },
      ),
    focus: `${HOME}/bin`,
    check: (fs) => {
      const mode = (n: string) => fs.stat(`${HOME}/bin/${n}`)?.mode;
      return (
        names(fs, `${HOME}/bin`).join(',') === 'README,backup.sh,secrets.env,start.sh,stop.sh' &&
        mode('start.sh') === 0o755 &&
        mode('stop.sh') === 0o755 &&
        mode('backup.sh') === 0o755 &&
        mode('README') === 0o644 &&
        mode('secrets.env') === 0o600 &&
        read(fs, `${HOME}/bin/secrets.env`) === 'API_TOKEN=redacted\n'
      );
    },
    solution: ['cd bin', 'chmod 755 start.sh stop.sh backup.sh', 'chmod 644 README && chmod 600 secrets.env', 'cd ~'],
  },
  {
    id: 'release',
    kind: 'files',
    title: 'Release notes',
    brief:
      `Assemble the release notes. ${HOME}/changelog has one file per version (1.0.txt, 1.1.txt, 1.2.txt), each holding one line. ` +
      `Create ${HOME}/release/NOTES.md whose first line is exactly "# Release 1.2" (without the quotes), followed by the ` +
      'three changelog lines newest first (1.2, then 1.1, then 1.0), copied verbatim. Also create ' +
      `${HOME}/release/VERSION containing the single line 1.2. Finally delete ${HOME}/changelog entirely.`,
    seed: (shell) =>
      seedFiles(shell, [`${HOME}/changelog`], {
        [`${HOME}/changelog/1.0.txt`]: '- 1.0: initial release\n',
        [`${HOME}/changelog/1.1.txt`]: '- 1.1: faster startup\n',
        [`${HOME}/changelog/1.2.txt`]: '- 1.2: retry failed uploads\n',
      }),
    focus: `${HOME}/release`,
    check: (fs) =>
      !fs.stat(`${HOME}/changelog`) &&
      names(fs, `${HOME}/release`).join(',') === 'NOTES.md,VERSION' &&
      sameText(read(fs, `${HOME}/release/NOTES.md`), NOTES_AFTER) &&
      sameText(read(fs, `${HOME}/release/VERSION`), '1.2\n') &&
      isFile(fs, `${HOME}/release/NOTES.md`),
    solution: [
      'mkdir release && echo "# Release 1.2" > release/NOTES.md',
      'cat changelog/1.2.txt changelog/1.1.txt changelog/1.0.txt >> release/NOTES.md',
      'echo 1.2 > release/VERSION && rm -r changelog',
    ],
  },
];
