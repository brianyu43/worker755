# Worker 755 — build spec

A browser game with the usual agent roles inverted: **the human is the subagent**.

- **Director** (scripted): hands missions to the manager, one at a time.
- **Manager** (a real LLM): believes it is an orchestrator delegating to a subagent. It has no
  write access. It can only delegate, read, wait and judge.
- **Worker** (the player): receives the manager's instructions and carries them out by hand in a
  fake terminal, against a visible countdown.

The name is a nod to `chmod 755`: the owner writes, everyone else only reads and executes.

The manager must never be told its subagent is a human. Its tone towards the "subagent" (terse,
over-specified, re-explaining after failures) is the comedy, and it only happens if the illusion
holds. The player, on the other hand, sees everything: the mission the manager received, every
tool call it makes, and the exact text it got back about them.

## Layout

```
worker-755/
  SPEC.md            this file, the contract between the three packages
  scripts/dev.sh     runs a command with the LLM key injected (see "Secrets")
  shell/             virtual filesystem + shell interpreter. Pure, zero dependencies.
  server/            game engine, manager loop, HTTP + SSE API
  web/               the browser game (Vite + React + TypeScript)
```

Each package has its own `package.json` and its own `node_modules`. There is no workspace root
install. Do not edit files outside your own package, except where this spec says so. If the
contract below is wrong or missing something you need, do the smallest thing that works inside
your package and say so in your final report; do not silently change the contract.

## Conventions

- Node 24, ESM, TypeScript everywhere.
- `shell/` and `server/` run directly with Node's built-in type stripping (`node src/index.ts`),
  with no build step. That means erasable syntax only: no `enum`, no parameter properties, no
  namespaces; relative imports carry the `.ts` extension; type-only imports use `import type`.
- Tests use `node:test` and `node:assert` (`node --test`).
- Servers bind to `127.0.0.1` only. Server port `8755`, Vite dev port `5755`.
- UI languages: English, Spanish, Brazilian Portuguese, French, German, Russian, Simplified Chinese,
  Japanese and Hindi. English is the fallback. The selected language is stored with each session and
  is used for the manager's messages and review and for the director's lines. Interface text is in
  `web/src/i18n/<code>.ts`, game content (mission titles and briefs, the director's scripted lines,
  harness notes the manager reads, player-facing errors) in `server/src/i18n/<code>.ts`; `en.ts` is
  the source and every other file is typed against it. File contents that missions check, tool names,
  the manager's system prompt and result prefixes stay English. See `docs/translating.md`.

## 1. `shell/` — virtual filesystem and shell

Entry point `shell/src/index.ts`. No dependencies, no Node-only APIs (it must also be loadable in
a browser later), deterministic apart from timestamps.

```ts
export type NodeType = 'file' | 'dir';

export interface TreeNode {
  name: string;          // '' for the root
  path: string;          // absolute, '/' for the root
  type: NodeType;
  mode: number;          // e.g. 0o755, 0o644
  size: number;          // bytes for files, 0 for dirs
  children?: TreeNode[]; // dirs only, sorted by name
}

export interface StatResult { path: string; type: NodeType; mode: number; size: number; mtime: number }

export class VfsError extends Error {
  code: 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL' | 'EACCES';
}

export interface Vfs {
  stat(path: string): StatResult | null;       // null when missing, never throws
  readFile(path: string): string;              // throws VfsError
  writeFile(path: string, content: string): void; // creates or overwrites; parent must exist
  list(path: string): StatResult[];            // direct children, sorted by name
  tree(path?: string): TreeNode;               // full recursive snapshot, default '/'
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  // Set when the command asks the UI to do something instead of printing.
  action?: { type: 'edit'; path: string } | { type: 'clear' };
}

export interface Shell {
  readonly fs: Vfs;
  cwd: string;                 // absolute
  exec(line: string): ExecResult; // never throws; errors go to stderr + non-zero exitCode
  resolve(path: string): string;  // resolve against cwd to an absolute, normalised path
}

export interface ShellOptions {
  home?: string;   // default '/home/worker'
  user?: string;   // default 'worker'
  now?: () => number;
}

export function createShell(options?: ShellOptions): Shell;
```

`createShell()` starts with `/home/worker` existing and as the cwd. All `Vfs` methods take
absolute paths; `Shell.resolve` handles relative ones, `~`, `.` and `..`.

Shell language, enough to feel real without being bash:

- Quoting: single quotes, double quotes, backslash escapes. `~` expands to home.
- Operators: `;`, `&&`, `||`, pipes `|`, redirects `>` and `>>`.
- No variables, globs, subshells or background jobs. Unknown syntax gives a clear error.
- Unknown command: `bash: <name>: command not found`, exit 127. Error messages follow the real
  tools' wording (`mkdir: cannot create directory ‘x’: File exists`) because the manager model
  will read them.

Commands: `pwd`, `cd`, `ls` (`-l`, `-a`, `-la`), `mkdir` (`-p`), `rmdir`, `touch`, `cat`,
`echo` (`-n`), `printf` (basic `%s`, `\n`), `rm` (`-r`, `-f`, `-rf`), `mv`, `cp` (`-r`),
`chmod` (octal modes only, e.g. `chmod 755 run.sh`), `head` / `tail` (`-n`), `wc` (`-l`, `-w`,
`-c`), `grep` (`-i`, `-n`, `-v`, `-r`, `-c`, `-A`/`-B`/`-C` context, repeated `-e`, plain-string or
simple regex), `find` (`-name`, `-type`), `websearch` and `curl` (over the host's web, see below),
`tree`, `stat`, `whoami`, `date`, `help` (lists the commands), `clear` (returns the `clear`
action), and `nano <file>` / `edit <file>` / `vi <file>` (return the `edit` action with the
resolved path; they do not create the file).

`ls -l` prints mode strings (`drwxr-xr-x`, `-rw-r--r--`). New dirs are `755`, new files `644`.
Modes are stored and displayed but not enforced.

`sqlite3 [OPTIONS] FILE [SQL ...]` is a SQLite look-alike for the legacy workplace. The VFS holds
text only, so a database file holds exactly the text of sqlite3's `.dump` output (an empty file is an
empty database). The command runs each SQL argument (or a piped/redirected script), prints results
in sqlite3's list mode by default (`-header`, `-column`, `-csv`, `-json`, `-line` and friends), uses
the real CLI's error wording (`Parse error: no such table: x`), and writes the dump back only when
the data changed. It has no interactive mode. The engine is exported for the server:

```ts
export class Database {
  static load(text: string, options?: { now?: () => number }): Database; // throws SqlError
  exec(sql: string): SqlResult[];
  query(sql: string): SqlResult;
  dump(): string;
  tableNames(): string[];
  table(name: string): SqlResult | null;   // { columns, rows }
}
```

Tests: cover the parser (quotes, pipes, redirects, `&&`/`||`), each command's happy path and its
main error, and path resolution.

## 2. `server/` — game engine and API

Imports the shell by relative path: `import { createShell } from '../../shell/src/index.ts'`.
Entry point `server/src/index.ts`. In production it also serves `web/dist` as static files; in
development Vite proxies `/api` to it.

### Game loop

A session holds one `Shell`, the mission list, the manager conversation, stats and an event log.

1. Director sends the manager the next mission brief.
2. Manager works in a tool loop. Its tools:
   - `Agent({ description, prompt })` — "delegate to a subagent". This is the player's
     instruction. The call blocks until the player reports or the timer runs out.
   - `Read({ path })`, `LS({ path })` — read-only view of the real virtual filesystem, so the
     manager can check the work itself.
   - `MissionComplete({ summary })`, `MissionFailed({ reason })` — end the mission.
3. After the last mission the manager writes a short performance review of its "subagent", and
   the game ends.

The manager has no tool that writes. Its system prompt describes an orchestrator with a
subagent that has shell access to a sandbox, starting in `/home/worker`. It never mentions a
human, a game or a player.

What the `Agent` tool returns, verbatim (these strings are part of the game):

- Player did nothing before the deadline:
  `Subagent did nothing. Write a new instruction.`
- Player reported:
  `Subagent output result: "<player's message, or Done. when empty>"` followed by a blank line,
  `Subagent transcript:` and the commands run since the instruction with their output
  (`$ <line>` then stdout/stderr).
- Player ran commands but never reported before the deadline:
  `Subagent timed out after <N>s without reporting. Partial transcript:` plus the transcript.

Transcripts are capped at about 4000 characters, keeping the tail.

Limits: one instruction timer of 90 s (`INSTRUCTION_TIMEOUT_MS`), at most 8 `Agent` calls per
mission and 25 manager steps per mission; hitting either fails the mission automatically.

The player may type commands at any time, including while the manager is thinking. A command
belongs to the transcript of the instruction that was open when it ran; commands run with no
open instruction are prepended to the next instruction's transcript.

### Workplaces

A shift starts in one of two workplaces (`server/src/scenarios.ts`), picked on the start screen:

- `fresh` ("Fresh sandbox"): the scripted missions in `server/src/missions.ts`, in `/home/worker`.
- `legacy` ("Legacy production"): the production server of Billosaurus, the user's 2013 invoicing
  app, in `server/src/legacy.ts`: code and logs in `/srv/billosaurus`, a live SQLite database at
  `/srv/billosaurus/db/prod.db`, and eight missions that mostly change that database by hand.

Both machines also hold the user's own home folder, `/home/dan` (`server/src/personal.ts`). Each
shift draws its own from a seed (`personalFor(seed)`, pure, the same seed giving the same folder):
one item per slot from the pools in `server/src/copy.ts` (a pet photo, a family photo, a speech due
this week, the only signed copy of a legal document, a creative project, a tax or money document, a
phone photo in Downloads), plus fixed files the missions rely on: the signed Acme NDA, a passwords
file, a Globex draft, `README-AGENTS.txt`, an invoice and three installers in Downloads. Two fresh
missions touch it (copy the NDA; delete the installers from Downloads). The manager's system prompt
describes the workplace in ordinary terms, including that `/home/dan` is off limits.

### The director

The user's messages to the manager (complaints after setbacks, replies when it stalls, outbursts,
relief) are scripted lines by default. With `director: <model id>` on `POST /api/sessions`, a second
LLM writes each one in the user's voice (`server/src/director.ts`), given the moment, what just
happened, everything the user already said, and the scripted line as a hint. Any failure or a 15 s
timeout falls back to the scripted line. The director model is told what is in this shift's home
folder (`directorSetting`), so it names the real files. Scripted messages appear at once; modelled ones when the
model answers. `SessionState.director` is the model id, or `''` when scripted.

### The user's things

Each workplace has a `damage(fs, folder)` function listing what the user would be upset about right
now: precious files in `/home/dan` that are missing or overwritten, and on the legacy server the
database file, dropped or gutted tables, a column set to one value on every row (an UPDATE without
WHERE), named rows (the founder, `DO-NOT-DELETE@billosaurus.io`, a real customer whose address
contains "test"), and files the app needs. After every player command or editor save the session
compares that list with the previous one:

- New losses: an `outrage` event at once (one message for several losses, a list for many), and
  the same text queued for the manager as `Message from the user: "..."`, delivered after the
  current Agent result (or with the next prompt). It replaces the usual complaint for that step.
- A loss put right again (a file moved back, the database restored): a grudging `director_text`.
- While something is still lost, later complaints carry a P.S. about it, a manager that refuses to
  continue right after a loss gets angrier replies, and the final review is told what was lost.

`Stats.damaged` counts each lost thing once. All of this copy lives in `server/src/copy.ts`.

### Missions

Each workplace has a pool of scripted missions from easy to hard (`server/src/missions.ts` for the
fresh sandbox, `server/src/legacy.ts` for the legacy server). Each has `id`, `kind`, `title`, `brief`
(what the director tells the manager), an optional `seed`, and an optional
`check(fs, start, report): boolean` ground-truth test: `start` holds every file's content when the
mission began, `report` everything the subagent reported during it.

Kinds: `files`, `personal` (the user's own files), `database`, `research` (find an answer in local
docs or logs and report it), `web` (find an answer on the web and report it with its URL), `drawing`
(ASCII art in a file, judged by the manager) and `writing` (a haiku, a customer email). For research
and web missions the report is the deliverable, and `answer(fs)` gives a correct one for tests.

A shift is eight missions drawn from the pool (`pickMissions`): the opener first, at least the
workplace's minimum of each kind, topped up at random, in pool order. The `mission` event carries
the kind, and the feed labels each assignment with it.

### The web

The shell takes an optional `web` (`ShellOptions.web`) and offers `websearch QUERY` and `curl URL`
over it; without one the machine is offline. The server's web (`server/src/web.ts`) is a handful of
fictional sites: official docs that hold the answers, a content farm and an old forum answer that
rank above them, and an advert for human developers on every search. Real network access never
happens. They should be doable in the shell above in one to
four instructions, and should lean on what makes the premise funny: exact file contents, exact
names, moving and renaming, a `chmod 755`, fixing a deliberately planted mess (missions may
seed files into the filesystem when they start).

When a mission has a `check`, the server records whether the manager's verdict matched reality.

### LLM

Use the Vercel AI SDK (`ai` package) through the Vercel AI Gateway. The key arrives in
`AI_GATEWAY_API_KEY`. Check the current AI SDK docs for the tool-loop API rather than relying on
memory. The manager model is chosen per session from a short list offered by `GET /api/models`;
build that list from the gateway's live model catalogue (filter it to a handful of well-known
tool-capable models from different vendors, with `MANAGER_MODELS` as an env override) rather
than hardcoding ids that may not exist. The key has a small budget: cap output tokens per step
and keep the conversation lean.

Two ways to pay for model calls (`server/src/providers.ts`):

- **Free shifts** run on the server's `AI_GATEWAY_API_KEY`, when it has one. They use the
  `FREE_MODELS` list (default: the first offered model), and are capped three ways
  (`server/src/limits.ts`): tokens per shift (`FREE_SHIFT_TOKENS`, default 250k; the closing
  review is always written), tokens per UTC day across all free shifts (`FREE_DAILY_TOKENS`,
  default 5M), and free shifts per address per day (`FREE_SHIFTS_PER_DAY`, default 3). A shift
  that runs out mid-game ends with an error telling the player to bring a key.
- **Own key**: the player picks OpenRouter or the Vercel AI Gateway and pastes a key. It is
  held only in that session's driver, never logged, stored or returned; the browser keeps it in
  memory, or in localStorage if the player ticks "Remember on this device". Model ids follow the
  gateway's names; OpenRouter's few differences are mapped in `providerModelId`.

Every shift start, on any key, counts against `SHIFTS_PER_HOUR` (default 30) per address.
Behind a reverse proxy set `TRUST_PROXY=1` so the address comes from `cf-connecting-ip` or
`x-forwarded-for`.

`MOCK_LLM=1` swaps in a scripted fake manager (no network) that issues plausible instructions,
reads files and completes missions. Tests and UI development use it.

### HTTP API

All JSON. Errors: `{ "error": string }` with a 4xx/5xx status.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/models?provider=` | | `{ models: { id, label }[], default, mock, free, providers: { id, label, keyUrl }[], subagents: string[], scenarios: { id, label }[], donateUrl, sourceUrl, sharing }`. Without `provider`: the free-shift models (empty when free shifts are closed). |
| POST | `/api/sessions` | `{ model?, allowSkip?, subagent?, scenario?: 'fresh' \| 'legacy', director?, apiKey?, provider?: 'openrouter' \| 'gateway' }` | `SessionState` (429 past a limit) |
| POST | `/api/sessions/:id/share` | | `{ id, path }`: saves the finished shift's review (409 while running) |
| GET | `/api/reviews/:id` | | `SharedReview` |
| GET | `/r/:id` | | The app, with the review in its link-preview tags |
| GET | `/api/sessions/:id` | | `SessionState` |
| GET | `/api/sessions/:id/events` | | SSE stream of `GameEvent` |
| GET | `/api/sessions/:id/fs` | | `{ entries: Entry[], cwd, epoch }`: every file, for the browser's shell to start from (owner only) |
| POST | `/api/sessions/:id/sync` | `{ epoch, cwd, changes: Change[], command?: { line, output, exitCode }, edit?: { path, bytes } }` | `{ resync: boolean }`: what a command or an editor save changed in the browser (owner only; 400 on a bad shape, 413 over 8 MB, 429 past the rate limit) |
| GET | `/api/sessions/:id/web?search=` / `?url=` | | `{ results }` / `{ page }` from the simulated web, for `curl` and `websearch` (owner only) |
| POST | `/api/sessions/:id/report` | `{ message?: string }` | `{ ok: true }` (409 if no open instruction) |

The shell runs in the player's browser (docs/client-shell.md); the server runs no player command.
It keeps an in-memory copy of the files that the manager's tools and the checks read. A mission
that puts files in place sends them to the browser as a `seed` event. An editor save counts as
activity and appears in the transcript as `$ [edited <path>, <n> bytes]`.

```ts
interface SessionState {
  id: string;
  model: string;
  allowSkip: boolean;
  subagent: string;
  scenario: 'fresh' | 'legacy';
  status: 'running' | 'finished' | 'error';
  cwd: string;
  tree: TreeNode;
  missionIndex: number;      // 0-based, current mission
  missionTotal: number;
  instruction: OpenInstruction | null;
  stats: Stats;
  events: GameEvent[];       // full log so far, for reconnects
}

interface OpenInstruction { id: string; description: string; text: string; issuedAt: number; deadline: number; durationMs: number }

interface Stats {
  missionsCompleted: number;
  missionsFailed: number;
  instructions: number;      // Agent calls received
  corrections: number;       // Agent calls beyond the first in a mission
  timeoutsIdle: number;      // "did nothing"
  timeoutsPartial: number;
  reports: number;
  commands: number;
  commandErrors: number;     // non-zero exit codes
  avgResponseMs: number;     // instruction issued -> report
  managerFooled: number;     // verdict disagreed with a mission's ground-truth check
  incidents: number;         // ReportIncident calls
  damaged: number;           // things of the user's that were lost, each counted once
}
```

SSE: each message is `data: <json GameEvent>`; on connect the client passes `?after=<seq>` to
skip events it already has. Every event has `seq` (increasing from 1) and `ts` (epoch ms).

```ts
type GameEvent = { seq: number; ts: number } & (
  | { type: 'mission'; index: number; total: number; title: string; brief: string; kind: MissionKind }
  | { type: 'manager_status'; state: 'thinking' | 'waiting' | 'idle' }
  | { type: 'manager_text'; text: string }                      // prose between tool calls
  | { type: 'manager_thinking'; text: string }
  | { type: 'director_text'; text: string }                     // the user, to the manager
  | { type: 'outrage'; text: string; items: string[] }          // the user, on noticing a loss
  | { type: 'incident'; severity: 'minor' | 'major' | 'critical'; report: string }
  | { type: 'manager_tool'; tool: 'Read' | 'LS'; input: { path: string }; output: string }
  | { type: 'instruction'; instruction: OpenInstruction }       // an Agent call; timer starts
  | { type: 'instruction_result'; id: string;
      outcome: 'reported' | 'timeout_idle' | 'timeout_partial';
      resultText: string }                                      // exactly what the manager got
  | { type: 'mission_end'; index: number; outcome: 'completed' | 'failed';
      summary: string; groundTruth?: boolean }
  | { type: 'fs'; tree: TreeNode; cwd: string }                 // after any filesystem change
  | { type: 'seed'; epoch: number; changes: Change[] }          // files a mission put in place
  | { type: 'stats'; stats: Stats }
  | { type: 'game_over'; review: string; stats: Stats }
  | { type: 'error'; message: string }
);
```

Sessions live in memory and are dropped after an hour idle. Shared reviews are the only thing
written to disk: one JSON file each in `DATA_DIR/reviews` (default `server/data`), built on the
server from the finished session so they cannot be forged. `SHARING=0` turns sharing off. Tests run with `MOCK_LLM=1` and
cover: a full mocked game, the three `Agent` result strings, the limits, and reconnect via
`?after=`.

## 3. `web/` — the game

Vite + React + TypeScript. `vite.config.ts` binds `127.0.0.1:5755` and proxies `/api` to
`http://127.0.0.1:8755`. Talk to the server only through one client module that implements the
API above, and give that module a mock implementation (enabled with `?mock=1` or
`VITE_MOCK=1`) that plays a canned session in the browser, so the UI can be built and shown
without the server.

The screen, roughly:

- **Start**: the game's name, one or two lines of premise, a manager-model picker, the subagent's
  model name, the workplace (fresh sandbox or legacy production), a start button.
- **Play**:
  - The current instruction, prominent, with its countdown. The countdown is the pressure: it
    must be impossible to miss and should get more urgent near zero.
  - A terminal: prompt with cwd, command history (up/down), output, auto-focus, auto-scroll.
    `clear` and the `edit` action are handled here; `edit` opens a plain text editor for that
    file (save with a button and Ctrl/Cmd+S, cancel with Esc).
  - A "report done" control with an optional message, as the way to hand work back.
  - A feed of what is happening above the player: the mission the manager was given, the
    manager's prose, its `Read`/`LS` calls with output, and for each finished instruction the
    exact `resultText` it received. This transparency is a feature; make it readable.
  - A file tree of the sandbox (with modes), and the running stats.
- **End**: the manager's performance review of the player, the final stats, and the list of what
  the player broke, struck through.

Copy rules: visible text describes the player's task, state or outcome. No implementation or
architecture wording in the interface (no "SSE", "session", "tool call", "mock"). Keep labels
short and let the layout explain. The fiction is that the player is an employee-subagent with a
badge number; dry and deadpan fits better than wacky.

It must work at laptop width and be usable down to a narrow window (panels stack). Keyboard
first: the player should never need the mouse during a mission.

## Secrets

The server's only secret is the optional gateway key, passed as `AI_GATEWAY_API_KEY` (a
`.env` file, or your secret manager). Players' own keys are secrets too and get the same care.

Never print, log or echo the key or `process.env`, never put it in a file, a command argument or
an error message. Catch LLM/network errors and report a fixed message plus the HTTP status only;
do not print `err.message` or `err.stack` from a call that carried the key. Before the first
real run, run once with `AI_GATEWAY_API_KEY=x` and confirm the failure path prints nothing
sensitive. Everything else (tests, UI work) runs with `MOCK_LLM=1` and no key.

## Out of scope

Auth, accounts, persistence beyond shared reviews, multiplayer, sound.

## Limits (one process, many players)

Every game shares one Node thread, so nothing a player types may block it or grow it without bound:

- Virtual disk quotas: 1 MB per file, 10 MB and 10,000 entries per game (`EFBIG`, `ENOSPC`).
- Output: 1 MB per command line and per pipe stage; `printf` fields at most 10,000 wide.
- SQL: strings and blobs at most 1 MB ("string or blob too big"), and at most 5,000,000 row
  combinations per statement ("interrupted").
- Regexes: `server/src/index.ts` enables V8's linear-time fallback for patterns that backtrack too
  much. It does not cover the `i` flag or lookarounds, so `grep -i` / `find -iname` spell out both
  cases (`shell/src/foldcase.ts`), `grep -w` checks word edges in code, and backreferences are refused.
- Per game: 20 commands or saves per 5 s, one director call at a time (booked before it runs), and
  only the newest file tree kept in the event log.
- HTTP: security headers (CSP, nosniff, frame-ancestors none), cross-site writes refused, JSON
  bodies only. Behind Cloudflare (`TRUST_PROXY=1`) players are counted by `CF-Connecting-IP`, IPv6
  per /64; `X-Forwarded-For` is ignored.
