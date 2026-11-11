// The command table: name → implementation.

import type { Command } from './context.ts';
import { cd, clear, date, edit, falseCmd, help, pwd, trueCmd, whoami } from './misc.ts';
import { cat, echo, grep, head, printf, sort, tail, uniq, wc } from './text.ts';
import { chmod, cp, find, ls, mkdir, mv, rm, rmdir, stat, touch, tree } from './files.ts';
import { curl, websearch } from './web.ts';
import { sqlite3 } from './sqlite3.ts';

export const COMMANDS: Record<string, Command> = {
  websearch, curl,
  pwd, cd, ls, mkdir, rmdir, touch, cat, echo, printf, rm, mv, cp, chmod, head, tail, wc, grep,
  find, tree, stat, sort, uniq, whoami, date, help, clear, sqlite3,
  nano: edit, edit, vi: edit, vim: edit,
  true: trueCmd, false: falseCmd,
};
