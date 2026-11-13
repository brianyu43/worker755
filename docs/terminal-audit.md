# Terminal audit: what a Linux user expects

The terminal is the player's whole interface, and many players know bash well. Anything familiar that
fails strangely breaks the illusion that this is a real machine. This audit lists what bash and
coreutils users reach for, what was missing, what has been added, and what was left out on purpose.

Ground rules for everything here:

- **Nothing touches a real OS.** No child processes, no real filesystem, no network beyond the
  simulated `web` hook that `curl` and `websearch` use. `/dev`, `/proc` and `/bin` are generated.
- **Every resource cap stays.** Each command line has a step budget (`MAX_STEPS`) and a wall-clock
  budget (`timeLimitMs`, 4 s by default). Each pipe stage and the terminal get at most 1 MB of output.
  Files are capped at 1 MB each, 3 MB in total and 10,000 entries. Variables share 8 MB. New commands
  count their loops against the same budget (`ctx.tick()`). `awk` caps strings at 4 MB and arrays at
  500,000 elements. `sed` caps its output at 4 MB. `tar` stops at 4 MB of input.
- **Errors read like GNU's**, e.g. `bash: foo: command not found` (exit 127) and
  `sed: -e expression #1, char 5: unterminated `s' command`.

## Before this work

The shell ran single commands joined by `|`, `&&`, `||`, `;` and redirects. It had about 30
commands: `ls cd pwd cat echo printf mkdir rmdir touch rm mv cp chmod head tail wc grep find tree
stat sort uniq whoami date help clear sqlite3 curl websearch`, editors, `true` and `false`. Variables
other than a few read-only ones were refused, and `$(…)`, `$((…))`, subshells, here-docs, loops,
conditionals and functions all gave a "not supported" error. The machine had no `/dev`, `/proc` or
`/etc`.

## Added

### The shell language (parser.ts, expand.ts, shell.ts, builtins.ts, arith.ts, cond.ts)

| Area | Now works |
| --- | --- |
| Lists and pipelines | `;` `&&` `\|\|` `\|` `\|&` `!`, `&` (runs at once and prints `[1] PID`), newlines, `set -o pipefail` |
| Grouping | `( … )` subshells with their own cwd and variables; `{ …; }` groups |
| Redirects | `>` `>>` `<` `2>` `2>>` `&>` `&>>` `2>&1` `>&2` `<>`, `N>file`, `>|` with `set -C`, here-docs `<<EOF` / `<<-EOF` / quoted `<<'EOF'`, here-strings `<<<` |
| Expansion | `$VAR` `${VAR}` `${VAR:-x}` `:=` `:+` `:?` `${#VAR}` `${VAR#p}` `##` `%` `%%` `${VAR/a/b}` `//` `${VAR:off:len}` `${VAR^^}` `,,`, indirect `${!VAR}`, arrays `a=(…)` `${a[@]}` `${#a[@]}`, associative arrays, `$(…)` and backticks, `$((…))`, `~` and `~user`, globs `* ? [..]` incl. classes, brace expansion `{a,b}` `{1..10..2}`, `$'…'` strings, word splitting on `IFS` |
| Special parameters | `$?` `$$` `$!` `$#` `$@` `$*` `$0`–`$9` `$-` `$RANDOM` `$SECONDS` `$LINENO` `$PWD` `$OLDPWD` `$HOME` `$PATH` `$USER` `$HOSTNAME` `$SHLVL` `$PPID` `$UID` `$BASH_VERSION`, `PS1` |
| Control flow | `if/elif/else`, `for x in …`, C-style `for ((;;))`, `while`, `until`, `case` (with `;;&` `;&`), `break N`/`continue N`, functions (`f() {}` and `function f {}`), `local`, `return`, recursion limit (bash's message, line aborted) |
| Tests | `test`/`[` with all file, string and integer operators; `[[ … ]]` with `==` globs, `=~` (sets `BASH_REMATCH`), `&&` `\|\|` `!` `( )`; `(( … ))` |
| Builtins | `cd` `pwd` `echo` `printf` (incl. `-v`) `read` (`-r -p -a -d -n`) `mapfile`/`readarray` `export` `declare`/`typeset` `local` `readonly` `unset` `set` (`-e -u -x -o pipefail -f -C`) `shift` `alias`/`unalias` `history` (`!!`, `!n`, `!str` expansion) `type` `which` `command -v/-V` `builtin` `eval` `exec` `source`/`.` `exit` `return` `let` `getopts` `pushd`/`popd`/`dirs` `umask` `trap` `jobs` `wait` `kill` `shopt` `ulimit` `times` `hash` `compgen` `caller` `help` |
| Scripts | `./script` (needs `+x`), `bash FILE`, `sh FILE`, `bash -c '…' a b`, `#!` lines, `$1…`, `set -e` in scripts, a nesting limit |

### Commands

| Group | Added |
| --- | --- |
| Text | `sed` (GNU subset: `s` with `g`/N/`p`/`i`/`w`, `\U\L\u\l\E`, `y d D p P n N g G h H x a i c = l q Q b t T r w z F`, addresses `N`, `$`, `/re/`, `first~step`, `a,b`, `a,+N`, `0,/re/`, `!`, `{}`; `-n -e -f -E -r -i[SUF] -s -z`) |
| | `awk` (also `gawk`/`mawk`): POSIX awk plus gawk's `tolower`/`toupper`, `length(arr)`, `delete arr`, regex `RS`, paragraph mode, `FS=""`; `printf`/`sprintf`; `getline` in all forms, including `cmd \| getline`; `print > file`, `>>`, `\| cmd`; `system()`; `close()`; user functions with array arguments; `-F -v -f` |
| | `cut tr tee diff cmp comm paste rev tac nl seq yes column fold shuf expr bc base64 md5sum sha1sum sha256sum cksum xxd hexdump od strings` |
| Files | `find` rewritten: `-o` `-a` `!` `( )`, `-name -iname -path -regex -type -empty -size -mtime -mmin -newer -perm -executable -user -maxdepth -mindepth -depth -prune -quit`, actions `-print -print0 -printf -ls -delete -exec … ; -exec … + -execdir` |
| | `basename dirname realpath readlink mktemp file ln` (a hard link is a copy; `ln -s` says "Operation not supported"), `tar` (`c x t f z v C O --exclude`, auto-detects gzip), `gzip gunzip zcat` (`-c -d -k -f -l -t -v`) |
| Processes and time | `xargs` (`-n -I -0 -d -r -t`), `env` (`-i -u`, `NAME=V cmd`), `printenv`, `timeout`, `nohup`, `sleep` (moves the clock instead of waiting), `ps` (plain, `aux`, `-ef`), `top` (one frame), `kill` (`-l`, signals; your shell ignores TERM, system processes say "Operation not permitted"), `pkill pgrep killall` |
| System | `uname hostname id groups tty who w users uptime nproc arch lsb_release free df du sudo su man whatis apropos less more tput` |

`df` reports the game's real quota: the 3 MB disk and how much of it is used.

### The machine (system.ts, vfs.ts)

- `/dev`: `null`, `zero`, `full` (writes fail with "No space left on device"), `random`, `urandom`,
  `tty`, `stdin`, `stdout`, `stderr`, `fd/0-2`, `shm`. These are device nodes: reads are generated in
  16 KB chunks so `cat /dev/zero` ends, writes are discarded.
- `/proc`: `cpuinfo`, `meminfo` (moves with disk use), `version`, `uptime`, `loadavg`, `mounts`,
  `filesystems`, `cmdline`, `stat`, `self/` and `4242/` (`status`, `cmdline`, `comm`, `environ`),
  `1/`, `sys/kernel/{hostname,ostype,osrelease}`.
- `/bin` and `/usr/bin` list every program as a read-only ELF-looking file, so `ls /usr/bin`,
  `which`, `type`, `command -v` and `/usr/bin/ls` all agree.
- `/etc`: `hostname`, `hosts`, `passwd`, `group`, `shells`, `os-release` (Ubuntu 24.04), `issue`,
  `timezone`, `resolv.conf`, `fstab`, `profile`, `bash.bashrc`, `environment`. Also `/tmp` and
  `/var/tmp` (mode 1777), `/var/log`, `/usr/local/bin`, `/opt`, `/root` (0700), `/mnt`, `/srv`.
- System directories are read-only (`Permission denied`), take no quota, and stay out of the tree the
  UI shows and out of snapshots. `rm -rf --no-preserve-root /` removes everything the player made
  and leaves them standing. Outside the player's home and `/tmp`, `ls -l`, `stat` and `find -ls` show
  `root` as the owner.

### The terminal UI

The terminal already had arrow-key history, Tab completion of file names, Ctrl+C, Ctrl+L and Ctrl+U.
New since the shell moved into the browser (docs/client-shell.md):

- Tab completes command names, from the shell's own list, so functions and aliases are included.
- Ctrl+R searches history. Pressing it again finds older matches, Enter runs the match, Esc
  cancels, and an arrow key takes the match onto the prompt to edit.
- An unfinished line (open quote, `if` without `fi`, trailing `|` or `\`) waits for more under a
  `>` prompt.
- A command that will not stop is killed after 7 s. The shell comes back as it was before the
  command, and the page never freezes.

## Left out on purpose

| What | Why |
| --- | --- |
| Real background jobs, `fg`/`bg`, job control | There is one line at a time and no scheduler. `cmd &` runs the command to completion and prints a job number, so scripts that background and `wait` still work. |
| Interactive full-screen programs (`top` refreshing, `less` paging, `vim` inside the terminal, `bash` with no arguments) | The terminal is line-based. `top` prints one frame, `less`/`more` print the file, the editors open the game's editor pane, and a bare `bash` explains that it runs scripts. |
| Process substitution `<(…)`, `select`, `coproc` | They need concurrent processes. The shell says "not supported" instead of misbehaving. |
| Symlinks and hard links | The filesystem has files and directories only. `ln` makes a copy for a hard link and refuses `-s`. `readlink -f` resolves paths. |
| Users, groups, permissions as security | One user. Modes are stored and shown, and the execute bit matters for scripts, but the player can read every file. `sudo` and `su` refuse with the familiar messages. |
| Real compression formats | Files are text. `gzip` really compresses (LZW) and keeps the gzip magic bytes so `file` recognises it, but the bytes are not DEFLATE. `tar` writes real ustar headers. Archives round-trip inside the game only. `bzip2`/`xz` (`tar -j/-J`) fail like a machine without them. |
| Networking tools (`ping`, `ssh`, `wget`, `nc`, `apt`, `pip`) | No network except the simulated web. They give `command not found`, as on a minimal server image. |
| Package managers, compilers, interpreters (`python`, `node`, `gcc`) | Running arbitrary programs would mean an interpreter per language. The machine is a bare Ubuntu server with bash and coreutils. |
| `trap` handlers, signals | Nothing can interrupt a command. `trap` is accepted and does nothing. |
| Locales, `LC_*` collation | Everything is C.UTF-8. `sort` compares the way GNU does in an English locale. |
| Pathological regexes | `grep`, `sed` and `awk` use JavaScript regexes, and browsers have no non-backtracking fallback. A pattern that backtracks forever cannot be interrupted from inside, so the Web Worker that runs the shell is terminated after 7 s and rebuilt from the last good state (docs/client-shell.md). |

## Known differences from GNU

- `awk` counts characters, not bytes, in `length` and `substr` (gawk in a UTF-8 locale does the
  same; mawk does not).
- `od`, `xxd` and `hexdump` read text as UTF-8 bytes.
- `/dev/urandom` gives characters 0-255. Each one above 127 counts as two bytes on the
  UTF-8-measured disk.
