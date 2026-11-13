// The command table: name → implementation.

import type { Command } from './context.ts';
import { cd, clear, date, edit, falseCmd, help, pwd, trueCmd, whoami } from './misc.ts';
import { cat, echo, grep, head, printf, sort, tail, uniq, wc } from './text.ts';
import { chmod, cp, find, ls, mkdir, mv, rm, rmdir, stat, touch, tree } from './files.ts';
import { curl, websearch } from './web.ts';
import { sqlite3 } from './sqlite3.ts';
import {
  base64, basename, bc, cksum, cmp, column, comm, cut, diff, dirname, expr, file, fold, hexdump, less, ln, md5sum, mktemp,
  nl, nohup, od, paste, printenv, readlink, realpath, rev, seq, sha1sum, sha256sum, shuf, sleep, strings, tac, tee, timeout,
  tput, tr, xargs, xxd, yes,
} from './coreutils.ts';
import { sed } from './sed.ts';
import { awk } from './awk.ts';
import { gunzip, gzip, tar, zcat } from './archive.ts';
import {
  apropos, arch, df, du, env, free, groups, hostname, id, kill, lsbRelease, man, nproc, pkill, ps, su, sudo, top, tty,
  uname, uptime, users, w, whatis, who,
} from './sysinfo.ts';

export const COMMANDS: Record<string, Command> = {
  websearch, curl,
  pwd, cd, ls, mkdir, rmdir, touch, cat, echo, printf, rm, mv, cp, chmod, head, tail, wc, grep,
  find, tree, stat, sort, uniq, whoami, date, help, clear, sqlite3,
  nano: edit, edit, vi: edit, vim: edit,
  true: trueCmd, false: falseCmd,
  cut, tr, tee, diff, cmp, comm, paste, rev, tac, nl, seq, yes, column, fold, shuf, expr, base64,
  md5sum, sha1sum, sha256sum, cksum, xxd, hexdump, od, strings, basename, dirname, realpath, readlink,
  mktemp, file, xargs, printenv, sleep, timeout, nohup, ln, less, more: less, tput, bc, sed, awk, gawk: awk, mawk: awk,
  tar, gzip, gunzip, zcat, env, uname, hostname, id, groups, tty, who, users, w, uptime, nproc, arch,
  lsb_release: lsbRelease, sudo, su, ps, top, kill, pkill, pgrep: pkill, killall: pkill, free, df, du, man, whatis, apropos,
};
