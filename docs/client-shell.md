# The terminal runs in the browser

The player's shell, its filesystem and its SQLite engine run client-side, in a Web Worker. The
server executes no player commands and writes nothing about the filesystem to disk. It keeps an
in-memory copy of each shift's files, the **mirror**. The manager's tools, the damage checks and the
mission checks read that copy.

```
 browser                                                    server (one Session per shift)
 ───────                                                    ──────────────────────────────
 Terminal.tsx ── client.exec(line) ─┐
                                    │  LocalShell (page)                    GET  /fs     ──► snapshot()
                                    ├─ last good state: files + vars        POST /sync   ──► parseSync → sync()
                                    │  watchdog, queue, sync backlog                            applyChanges(mirror)
                                    ▼                                                           transcript, stats
                              worker.ts (Web Worker)                                            fs event, checkDamage()
                              VirtualShell from shell/                      GET  /web    ──► WEB.search / WEB.fetch
                              journal → Change[]                            events: seed ◄── mission.seed(mirror)
```

## Browser

**`web/src/shell/worker.ts`** runs `VirtualShell` from `shell/`. On `init` it loads the server's
snapshot, adds the generated system directories (`/dev`, `/proc`, `/bin`) and turns on the VFS
journal. After each command it returns the result, the cwd, the changes the journal recorded
(`collectChanges`) and the shell's own state (variables, functions, aliases, history, options).

**`web/src/shell/local.ts`** (`LocalShell`) is the page's side:

- It keeps the **last good state**: a `MemoryVfs` with the changes of every finished command applied,
  plus the latest shell snapshot.
- A **watchdog** (7 s) covers what the shell cannot stop by itself. The shell stops its own commands
  at 4 s or 2,000,000 steps. Regular expressions are the exception: browsers have no V8
  non-backtracking fallback, so `grep -E '^(a+)+$'` would block forever. When the watchdog fires,
  the worker is terminated and a new one starts from the last good state. The terminal prints
  `Killed` and says nothing from that command was kept. The page never freezes, because the worker
  is a separate thread.
- One thing happens at a time (`exclusive`). Commands, editor saves, mission seeds and reloads run in
  order, so the worker, the last good state and the server see changes in the same order.

**`web/src/api/client.ts`** (the real client) keeps the `GameClient` interface, so the UI did not
change shape:

- `exec`, `readFile` and `writeFile` go to the local shell. After a command or a save, the client
  posts its changes to `/sync` in the same queue step.
- Sends that fail (no network, 429, 5xx) stay in an ordered **backlog** and go first next time. The
  terminal says the command ran and the manager will see it when the connection is back.
- `resync: true` from the server, or a 400/413, makes the shell reload the server's files once the
  backlog is through. Variables and history stay.
- `seed` events from the event stream are applied to the local shell (`applySeed`). Their epoch
  stops the same seed being applied twice.
- A page reload starts a new shell from `GET /fs`. The files come back from the mirror. Shell
  variables and history start fresh, as in a new terminal window.

Only the browser that started the shift (the one holding the `X-Session-Token`) runs a shell. Someone
watching through the link sees the events and the file tree and runs nothing.

The terminal also gained what a local shell makes easy: Tab completion of command names (from the
shell's own list, including functions and aliases), Ctrl+R reverse history search, and multi-line
input with a `>` prompt. The parser's `isIncomplete` decides when a line needs more.

## Server

**The mirror** is a `VirtualShell` per session (`Session.shell`). It runs only the game's own setup:
the scenario's seed when the shift is created, and each mission's seed when the mission starts. A
mission seed is recorded with `changesOf()` and broadcast as `{ type: 'seed', epoch, changes }`, and
`Session.epoch` goes up by one. Player input only ever arrives as data:

- **`GET /api/sessions/:id/fs`** (owner only): every file and directory (`exportEntries`), the cwd
  and the epoch.
- **`POST /api/sessions/:id/sync`** (owner only): `{ epoch, cwd, changes, command? | edit? }`.
  - `parseSync` checks shape and size. Paths must be absolute and normalised. Modes are 0-07777 and
    types are file or dir. A file is at most 1 MB, a sync carries at most 3 MB of content and 10,000
    entries, a line at most 10,000 characters, and only the last 16 KB of output is kept.
  - `applyChanges` puts the changes in place with the same quotas as the browser. System
    directories are refused. Nothing is evaluated: a file named `$(rm -rf /)` is just a name.
  - The command goes into the manager's transcript and the stats. Then the usual `fs` event,
    `checkDamage()` and (later) `mission.check()` run on the mirror.
  - The reply is `{ resync }`: true when the browser's epoch is behind (it ran a command before a
    seed reached it) or when the changes did not fit.
- **`GET /api/sessions/:id/web?search=|url=`** (owner only) serves the simulated web for `curl` and
  `websearch`. The worker calls it with a synchronous `XMLHttpRequest`, which workers may make.
  The shell's `Web` hook is synchronous, and the made-up web, including the pages that answer
  missions, stays on the server rather than in the bundle.

The mirror lives in memory and goes away with the session. Nothing about a player's files is
written to disk.

### Limits

| What | Limit |
| --- | --- |
| Syncs per session | the existing command rate limit, 20 per 5 s; the client retries a 429 |
| Sync body | 8 MB (a 1 MB file of control characters is about 6 MB as JSON); 413 above |
| Sync bytes per address | 40 MB per minute (`WindowBudget`) |
| Web lookups per address | 300 per minute |
| Everything else | unchanged: X-Session-Token on mutating routes, shift and key-check limits, long-poll events |

The per-address shell-time budget (`TimeBudget`) was dropped together with `POST /exec`: the server
no longer spends time running shells. `GET`/`PUT /file` are gone too. The editor reads and saves
through the local shell, and a save is a sync with `edit` set.

## Decisions

### SQLite: the in-house engine on both sides, not sqlite-wasm

I checked whether the server could inspect a real SQLite database: Node 24's `node:sqlite` has
`DatabaseSync.prototype.deserialize`, so it can load a database from bytes in memory without a file.
WASM SQLite is possible, but the in-house engine stays, for these reasons:

1. **The server would parse untrusted binary database images from every client on every command**,
   with C code. SQLite's own guidance treats a database file from an untrusted source as an attack
   surface (it calls for defensive mode and integrity checks first). The in-house engine is
   memory-safe TypeScript with a work limit and a time limit.
2. **The filesystem holds text, and so does the game around the database.** `prod.db` is a SQL dump.
   The manager's `Read` tool shows it as one (the legacy scenario tells the manager so). The legacy
   seed, the database missions and the damage checks (dropped tables, deleted invoices) are written
   against it. Binary files would need a byte-accurate VFS, new quota accounting and a second
   engine on the server.
3. **The same engine on both sides means the damage checks see exactly what the player saw.** Two
   engines could disagree about a statement's effect, and the server's verdict would then be wrong.
4. **The shell is synchronous and WASM loads asynchronously.** Lazy-loading it on the first
   `sqlite3` would need the command aborted, the state rolled back and the line re-run.
5. **Weight.** The engine is part of a 360 KB worker chunk; sqlite-wasm adds about 1 MB.

Because no WASM runs, the CSP stays `script-src 'self'` without `'wasm-unsafe-eval'`. The worker is
a same-origin module script, which `'self'` already allows.

### Starting state: the server's snapshot, not a seed sent to the browser

The personal folder is a pure function of its seed, so the browser could build it. Instead the
browser starts from the server's files (`GET /fs`):

- Mission seeds run mid-shift on the server, so a server-to-browser path for files was needed
  anyway. Using the same path for the start means one mechanism, not two.
- Building the folder in the browser would put the game's content (the personal folder, the legacy
  company with its database and source, every mission seed) into the bundle, along with the code
  that makes it.
- "Identical on both sides" then holds by construction: the browser loads exactly the server's
  entries (`exportEntries`/`loadSnapshot`, tested in `shell/test/sync.test.ts` and
  `server/test/sync.test.ts`).

The snapshot is a few hundred kilobytes at most (the quotas cap it at 3 MB), sent once per shift and
again after a page reload.

### What the journal records

The VFS records, per path, either `tree` (the path and everything under it changed) or `meta` (only
its mode and time). Adding or removing a child marks the parent's time too, so directory times stay
equal on both sides. `collectChanges` turns the journal into `put` (the subtree, parents first),
`meta` and `rm` records, leaving out anything covered by a changed ancestor and anything in a system
directory. `applyChanges` applies removals, then puts, then metas.

## Trust

The player controls their browser and could send the server any files or any "output". That is
acceptable for a single-player game: they can only fool their own manager. The server's duty is to
stay safe and fair to other players. It validates every sync's shape and size, applies it under the
same quotas, never evaluates it, rate-limits it per session and per address, and keeps it only in
memory. The transcript lines a sync carries are capped and reach the manager as quoted command
output, as before.

## Tests

- `shell/test/sync.test.ts`: whatever commands do (copies, moves, tar, `sed -i`, `find -delete`,
  replacing a directory with a file), the recorded changes rebuild the same tree elsewhere. System
  files are never part of it.
- `server/test/sync.test.ts`: validation, nothing runs on the server, quotas and resync, identical
  starting state for both workplaces, seeds reaching the browser, epochs, damage through sync, and
  the endpoint's ownership, size cap and rate limit.
- `server/test/player.ts` is the browser's side in tests. Every session and HTTP test now plays
  through it, as the browser does.
