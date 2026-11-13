// The machine around the files: env, uname, hostname, id, groups, whoami's friends, ps, top, kill, uptime,
// free, df, du, nproc, arch, tty, who, w, sudo, su, lsb_release, man, whatis. Processes are a fixed,
// believable list (bash and whatever is running now); nothing here touches a real system.

import type { Command, CommandContext } from './context.ts';
import { abs, fail, lq, pad2, parseOptions, statArg, usage } from './context.ts';
import { errorText, MAX_TOTAL_BYTES } from '../vfs.ts';
import { join } from '../path.ts';
import { PID } from '../shell.ts';
import { KERNEL, KERNEL_VERSION, MEM_TOTAL_KB, uptimeSeconds } from '../system.ts';

/** Shell-quote a word for a command line built from argv. */
function shq(s: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---- env ---------------------------------------------------------------------------------

export const env: Command = (ctx) => {
  const vars = { ...ctx.env() };
  const set: [string, string][] = [];
  let clear = false;
  let nul = false;
  let i = 0;
  const args = ctx.args;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-i' || a === '-' || a === '--ignore-environment') clear = true;
    else if (a === '-0' || a === '--null') nul = true;
    else if (a === '-u' || a === '--unset') {
      const n = args[++i];
      if (n === undefined) return usage(ctx, "option requires an argument -- 'u'", 125);
      delete vars[n];
      set.push([n, '\0unset']);
    } else if (a.startsWith('-u')) {
      delete vars[a.slice(2)];
      set.push([a.slice(2), '\0unset']);
    } else if (a === '--help') {
      ctx.out('Usage: env [OPTION]... [-] [NAME=VALUE]... [COMMAND [ARG]...]\nSet each NAME to VALUE in the environment and run COMMAND.\n\n  -i, --ignore-environment  start with an empty environment\n  -0, --null           end each output line with NUL, not newline\n  -u, --unset=NAME     remove variable from the environment\n');
      return 0;
    } else if (a === '--') {
      i++;
      break;
    } else if (a.startsWith('-') && a.length > 1) return usage(ctx, `invalid option -- '${a[1]}'`, 125);
    else break;
  }
  for (; i < args.length && /^[^=]+=/.test(args[i]); i++) {
    const k = args[i].slice(0, args[i].indexOf('='));
    const v = args[i].slice(k.length + 1);
    vars[k] = v;
    set.push([k, v]);
  }
  const shown = clear ? Object.fromEntries(set.filter(([, v]) => v !== '\0unset')) : vars;
  if (i >= args.length) {
    ctx.out(Object.entries(shown).map(([k, v]) => `${k}=${v}${nul ? '\0' : '\n'}`).join(''));
    return 0;
  }
  // Run the command in a child shell with the changed environment.
  const prefix = set.filter(([, v]) => v !== '\0unset').map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const unsets = set.filter(([, v]) => v === '\0unset').map(([k]) => `unset ${shq(k)}; `).join('');
  const line = `${unsets}${prefix ? prefix + ' ' : ''}exec ${args.slice(i).map(shq).join(' ')}`;
  const status = ctx.run(['bash', '-c', line]);
  return status === 127 ? 127 : status;
};

// ---- identity ----------------------------------------------------------------------------

export const uname: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'asnrvmpio',
    long: { all: 'a', 'kernel-name': 's', nodename: 'n', 'kernel-release': 'r', 'kernel-version': 'v', machine: 'm', processor: 'p', 'hardware-platform': 'i', 'operating-system': 'o' },
  });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length) return usage(ctx, `extra operand ${lq(opts.operands[0])}`);
  const f = opts.flags;
  const all = f.has('a');
  const parts: string[] = [];
  if (all || f.has('s') || f.size === 0) parts.push('Linux');
  if (all || f.has('n')) parts.push(ctx.state.hostname);
  if (all || f.has('r')) parts.push(KERNEL);
  if (all || f.has('v')) parts.push(KERNEL_VERSION);
  if (all || f.has('m')) parts.push('x86_64');
  if (!all && f.has('p')) parts.push('x86_64');
  if (!all && f.has('i')) parts.push('x86_64');
  if (all || f.has('o')) parts.push('GNU/Linux');
  ctx.out(parts.join(' ') + '\n');
  return 0;
};

export const hostname: Command = (ctx) => {
  const a = ctx.args[0];
  if (a === '-I' || a === '--all-ip-addresses') ctx.out('10.0.7.55 \n');
  else if (a === '-i' || a === '--ip-address') ctx.out('127.0.1.1\n');
  else if (a === '-f' || a === '--fqdn' || a === '-s' || a === '--short' || a === undefined) ctx.out(ctx.state.hostname + '\n');
  else if (a.startsWith('-')) return usage(ctx, `invalid option -- '${a.slice(1, 2)}'`);
  else {
    fail(ctx, 'you must be root to change the host name');
    return 1;
  }
  return 0;
};

export const id: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'ugGnr', long: { user: 'u', group: 'g', groups: 'G', name: 'n', real: 'r' } });
  if (typeof opts === 'number') return opts;
  const user = ctx.state.user;
  const who = opts.operands[0];
  if (who !== undefined && who !== user && who !== '1000') {
    if (who === 'root' || who === '0') {
      if (opts.flags.has('u')) ctx.out(opts.flags.has('n') ? 'root\n' : '0\n');
      else ctx.out('uid=0(root) gid=0(root) groups=0(root)\n');
      return 0;
    }
    fail(ctx, `${lq(who)}: no such user`);
    return 1;
  }
  const f = opts.flags;
  if (f.has('u') || f.has('g')) ctx.out(f.has('n') ? `${user}\n` : '1000\n');
  else if (f.has('G')) ctx.out(f.has('n') ? `${user}\n` : '1000\n');
  else ctx.out(`uid=1000(${user}) gid=1000(${user}) groups=1000(${user})\n`);
  return 0;
};

export const groups: Command = (ctx) => {
  const who = ctx.args[0];
  ctx.out(who ? `${who} : ${who === 'root' ? 'root' : ctx.state.user}\n` : `${ctx.state.user}\n`);
  return 0;
};

export const tty: Command = (ctx) => {
  if (ctx.args[0] === '-s' || ctx.args[0] === '--silent' || ctx.args[0] === '--quiet') return ctx.stdinIsTty ? 0 : 1;
  if (!ctx.stdinIsTty) {
    ctx.out('not a tty\n');
    return 1;
  }
  ctx.out('/dev/pts/0\n');
  return 0;
};

export const who: Command = (ctx) => {
  if (ctx.args.includes('-b')) {
    ctx.out(`         system boot  ${timeStamp(ctx.state.now() - uptimeSeconds(ctx.state.now()) * 1000)}\n`);
    return 0;
  }
  if (ctx.args.length >= 2 && ctx.args[0] === 'am' && /^i$/i.test(ctx.args[1])) {
    ctx.out(`${ctx.state.user} pts/0        ${timeStamp(ctx.state.now() - 3_600_000)}\n`);
    return 0;
  }
  ctx.out(`${ctx.state.user.padEnd(8)} pts/0        ${timeStamp(ctx.state.now() - 3_600_000)} (10.0.7.1)\n`);
  return 0;
};

export const users: Command = (ctx) => {
  ctx.out(ctx.state.user + '\n');
  return 0;
};

function timeStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function upText(now: number): string {
  const s = uptimeSeconds(now);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${days} day${days === 1 ? '' : 's'}, ${String(h).padStart(2)}:${pad2(m)}`;
}

export const uptime: Command = (ctx) => {
  const now = ctx.state.now();
  if (ctx.args[0] === '-p' || ctx.args[0] === '--pretty') {
    const s = uptimeSeconds(now);
    ctx.out(`up ${Math.floor(s / 86400)} days, ${Math.floor((s % 86400) / 3600)} hours, ${Math.floor((s % 3600) / 60)} minutes\n`);
    return 0;
  }
  if (ctx.args[0] === '-s' || ctx.args[0] === '--since') {
    ctx.out(timeStamp(now - uptimeSeconds(now) * 1000) + ':00\n');
    return 0;
  }
  ctx.out(` ${clock(now)} up ${upText(now)},  1 user,  load average: 0.08, 0.03, 0.01\n`);
  return 0;
};

export const w: Command = (ctx) => {
  const now = ctx.state.now();
  ctx.out(
    ` ${clock(now)} up ${upText(now)},  1 user,  load average: 0.08, 0.03, 0.01\n` +
    'USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU  WHAT\n' +
    `${ctx.state.user.padEnd(8)} pts/0    10.0.7.1         ${clock(now - 3_600_000).slice(0, 5)}    0.00s  0.04s  0.00s w\n`,
  );
  return 0;
};

export const nproc: Command = (ctx) => {
  ctx.out('2\n');
  return 0;
};

export const arch: Command = (ctx) => {
  ctx.out('x86_64\n');
  return 0;
};

export const lsbRelease: Command = (ctx) => {
  const a = ctx.args.join(' ');
  const lines: string[] = [];
  const all = /-a|--all/.test(a) || a === '';
  const short = /-s|--short/.test(a);
  const want = (flag: string, long: string) => all || new RegExp(`-\\w*${flag}|--${long}`).test(a);
  if (want('i', 'id')) lines.push(short ? 'Ubuntu' : 'Distributor ID:\tUbuntu');
  if (want('d', 'description')) lines.push(short ? 'Ubuntu 24.04.1 LTS' : 'Description:\tUbuntu 24.04.1 LTS');
  if (want('r', 'release')) lines.push(short ? '24.04' : 'Release:\t24.04');
  if (want('c', 'codename')) lines.push(short ? 'noble' : 'Codename:\tnoble');
  if (!short && all) ctx.err('No LSB modules are available.\n');
  ctx.out(lines.join('\n') + '\n');
  return 0;
};

export const sudo: Command = (ctx) => {
  if (!ctx.args.length) {
    ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [<command>]\n');
    return 1;
  }
  ctx.err(`${ctx.state.user} is not in the sudoers file.  This incident will be reported.\n`);
  return 1;
};

export const su: Command = (ctx) => {
  ctx.err('Password: \nsu: Authentication failure\n');
  return 1;
};

// ---- processes ---------------------------------------------------------------------------

interface Proc {
  pid: number;
  user: string;
  cmd: string;
  args: string;
  tty: string;
  stat: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  start: string;
  time: string;
}

function processes(ctx: CommandContext, self: string): Proc[] {
  const user = ctx.state.user;
  return [
    { pid: 1, user: 'root', cmd: 'init', args: '/sbin/init', tty: '?', stat: 'Ss', cpu: 0, mem: 0.5, vsz: 167_700, rss: 11_520, start: 'Nov08', time: '0:04' },
    { pid: 89, user: 'root', cmd: 'cron', args: '/usr/sbin/cron -f -P', tty: '?', stat: 'Ss', cpu: 0, mem: 0.1, vsz: 6_696, rss: 2_688, start: 'Nov08', time: '0:00' },
    { pid: 112, user: 'syslog', cmd: 'rsyslogd', args: '/usr/sbin/rsyslogd -n -iNONE', tty: '?', stat: 'Ssl', cpu: 0, mem: 0.2, vsz: 222_404, rss: 5_248, start: 'Nov08', time: '0:01' },
    { pid: 4241, user: 'root', cmd: 'sshd', args: `sshd: ${user} [priv]`, tty: '?', stat: 'Ss', cpu: 0, mem: 0.5, vsz: 17_152, rss: 10_880, start: clock(ctx.state.now() - 3_600_000).slice(0, 5), time: '0:00' },
    { pid: PID, user, cmd: 'bash', args: '-bash', tty: 'pts/0', stat: 'Ss', cpu: 0, mem: 0.2, vsz: 8_660, rss: 5_120, start: clock(ctx.state.now() - 3_600_000).slice(0, 5), time: '0:00' },
    { pid: PID + 101, user, cmd: self, args: [self, ...ctx.args].join(' '), tty: 'pts/0', stat: 'R+', cpu: 0, mem: 0.1, vsz: 11_316, rss: 4_480, start: clock(ctx.state.now()).slice(0, 5), time: '0:00' },
  ];
}

export const ps: Command = (ctx) => {
  const a = ctx.args.join(' ');
  const all = /(^|\s)-?[a-zA-Z]*[aeAx]/.test(a);
  const full = /(^|\s)-[a-zA-Z]*f/.test(a);
  const bsd = /(^|\s)[a-zA-Z]*u/.test(a) && !a.startsWith('-');
  let list = processes(ctx, 'ps');
  if (!all) list = list.filter((p) => p.tty === 'pts/0');
  if (a.startsWith('-p ') || a.includes(' -p ')) {
    const pids = (a.split(/-p\s+/)[1] ?? '').split(/[,\s]+/).map(Number);
    list = processes(ctx, 'ps').filter((p) => pids.includes(p.pid));
  }
  let out: string;
  if (bsd) {
    out = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
    for (const p of list) {
      out += `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(p.vsz).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${p.stat.padEnd(4)} ${p.start.padStart(5)}   ${p.time} ${p.args}\n`;
    }
  } else if (full) {
    out = 'UID          PID    PPID  C STIME TTY          TIME CMD\n';
    for (const p of list) {
      const ppid = p.pid === 1 ? 0 : p.pid === PID ? 4241 : p.pid > PID ? PID : 1;
      out += `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(ppid).padStart(7)}  0 ${p.start.padStart(5)} ${p.tty.padEnd(8)} 00:00:0${p.time.slice(-1)} ${p.args}\n`;
    }
  } else {
    out = '    PID TTY          TIME CMD\n';
    for (const p of list) out += `${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:00 ${p.cmd}\n`;
  }
  ctx.out(out);
  return list.length ? 0 : 1;
};

export const top: Command = (ctx) => {
  const now = ctx.state.now();
  const used = 640_000 + (ctx.fs.usage().bytes >> 10);
  const mib = (kb: number) => (kb / 1024).toFixed(1).padStart(8);
  let out =
    `top - ${clock(now)} up ${upText(now)},  1 user,  load average: 0.08, 0.03, 0.01\n` +
    'Tasks:   6 total,   1 running,   5 sleeping,   0 stopped,   0 zombie\n' +
    '%Cpu(s):  0.3 us,  0.2 sy,  0.0 ni, 99.5 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st\n' +
    `MiB Mem : ${mib(MEM_TOTAL_KB)} total, ${mib(MEM_TOTAL_KB - used - 712_000)} free, ${mib(used)} used, ${mib(712_000)} buff/cache\n` +
    `MiB Swap:      0.0 total,      0.0 free,      0.0 used. ${mib(MEM_TOTAL_KB - used)} avail Mem\n\n` +
    '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n';
  for (const p of processes(ctx, 'top')) {
    out += `${String(p.pid).padStart(7)} ${p.user.padEnd(8)}  20   0 ${String(p.vsz).padStart(7)} ${String(p.rss).padStart(6)} ${String(Math.floor(p.rss * 0.7)).padStart(6)} ${p.stat[0]}   ${p.cpu.toFixed(1).padStart(3)}   ${p.mem.toFixed(1).padStart(3)}   0:00.0${p.pid % 10} ${p.cmd}\n`;
  }
  ctx.out(out);
  return 0;
};

const SIGNALS = ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'POLL', 'PWR', 'SYS'];

export const kill: Command = (ctx) => {
  const args = [...ctx.args];
  if (!args.length) {
    ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n');
    return 2;
  }
  if (args[0] === '-l' || args[0] === '-L') {
    if (args[1]) {
      const n = Number(args[1]);
      const name = Number.isInteger(n) ? SIGNALS[(n > 128 ? n - 128 : n) - 1] : undefined;
      if (Number.isInteger(n)) {
        if (!name) {
          ctx.err(`bash: kill: ${args[1]}: invalid signal specification\n`);
          return 1;
        }
        ctx.out(name + '\n');
      } else {
        const k = SIGNALS.indexOf(args[1].toUpperCase().replace(/^SIG/, ''));
        if (k < 0) {
          ctx.err(`bash: kill: ${args[1]}: invalid signal specification\n`);
          return 1;
        }
        ctx.out(k + 1 + '\n');
      }
      return 0;
    }
    ctx.out(SIGNALS.map((s, k) => `${String(k + 1).padStart(2)}) SIG${s}`).reduce((acc, s, k) => acc + s.padEnd(16) + ((k + 1) % 5 === 0 ? '\n' : '\t'), '').trimEnd() + '\n');
    return 0;
  }
  if (args[0] === '-s' || args[0] === '-n') args.splice(0, 2);
  else if (/^-/.test(args[0]) && args[0] !== '--') {
    const sig = args[0].slice(1).toUpperCase().replace(/^SIG/, '');
    if (!/^\d+$/.test(sig) && !SIGNALS.includes(sig)) {
      ctx.err(`bash: kill: ${args[0].slice(1)}: invalid signal specification\n`);
      return 1;
    }
    args.shift();
  }
  if (args[0] === '--') args.shift();
  let status = 0;
  const pids = new Set(processes(ctx, 'kill').map((p) => p.pid));
  for (const a of args) {
    if (!/^-?\d+$/.test(a)) {
      ctx.err(`bash: kill: ${a}: arguments must be process or job IDs\n`);
      status = 1;
      continue;
    }
    const pid = Number(a);
    // Your own shell shrugs off TERM, as an interactive bash does; the system's processes are not yours.
    if (pid === PID) continue;
    if (pids.has(pid) && pid < PID) {
      ctx.err(`bash: kill: (${pid}) - Operation not permitted\n`);
      status = 1;
      continue;
    }
    ctx.err(`bash: kill: (${pid}) - No such process\n`);
    status = 1;
  }
  return status;
};

export const pkill: Command = (ctx) => {
  const name = ctx.args.filter((a) => !a.startsWith('-')).pop();
  if (!name) {
    ctx.err(`${ctx.name}: no matching criteria specified\nTry \`${ctx.name} --help' for more information.\n`);
    return 2;
  }
  const hit = processes(ctx, ctx.name).find((p) => p.cmd === name || p.cmd.includes(name));
  if (ctx.name === 'pgrep') {
    for (const p of processes(ctx, ctx.name)) if (p.cmd.includes(name)) ctx.out(p.pid + '\n');
    return hit ? 0 : 1;
  }
  if (hit && hit.user !== ctx.state.user) {
    ctx.err(`${ctx.name}: killing pid ${hit.pid} failed: Operation not permitted\n`);
    return 1;
  }
  if (!hit && ctx.name === 'killall') {
    ctx.err(`${name}: no process found\n`);
    return 1;
  }
  return hit ? 0 : 1;
};

// ---- memory and disk ---------------------------------------------------------------------

export const free: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'bkmghwtl', long: { bytes: 'b', kibi: 'k', mebi: 'm', gibi: 'g', human: 'h', wide: 'w', total: 't' } });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const used = 640_000 + (ctx.fs.usage().bytes >> 10);
  const cache = 712_000;
  const freeKb = MEM_TOTAL_KB - used - cache;
  const fmt = (kb: number): string => {
    if (f.has('h')) return human(kb * 1024, true);
    if (f.has('b')) return String(kb * 1024);
    if (f.has('m')) return String(Math.floor(kb / 1024));
    if (f.has('g')) return String(Math.floor(kb / 1024 / 1024));
    return String(kb);
  };
  const row = (label: string, cols: number[]) => label.padEnd(7) + cols.map((c) => fmt(c).padStart(12)).join('') + '\n';
  let out = '               total        used        free      shared  buff/cache   available\n';
  out += row('Mem:', [MEM_TOTAL_KB, used, freeKb, 1_024, cache, MEM_TOTAL_KB - used]);
  out += row('Swap:', [0, 0, 0]);
  if (f.has('t')) out += row('Total:', [MEM_TOTAL_KB, used, freeKb]);
  ctx.out(out);
  return 0;
};

/** 1.5K, 20M — the -h style of df, du and free (free uses Ki/Mi). */
function human(bytes: number, iec = false): string {
  const units = iec ? ['B', 'Ki', 'Mi', 'Gi', 'Ti'] : ['', 'K', 'M', 'G', 'T'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return iec ? `${v}B` : String(v);
  const s = v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v));
  return s + units[u];
}

export const df: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'hHkTaPil', long: { human: 'h', 'human-readable': 'h', si: 'H', 'print-type': 'T', all: 'a', portability: 'P', inodes: 'i', local: 'l' } });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const taken = ctx.fs.usage();
  // The home disk is the game's real quota: what a player can store is what df reports.
  const sizeKb = MAX_TOTAL_BYTES / 1024;
  const usedKb = Math.ceil(taken.bytes / 1024);
  type Row = { fs: string; type: string; size: number; used: number; mount: string };
  const rows: Row[] = [
    { fs: 'overlay', type: 'overlay', size: sizeKb, used: usedKb, mount: '/' },
    { fs: 'tmpfs', type: 'tmpfs', size: 65_536, used: 0, mount: '/dev' },
    { fs: '/dev/vda1', type: 'ext4', size: sizeKb, used: usedKb, mount: ctx.state.home },
  ];
  let shown = rows;
  if (opts.operands.length) {
    shown = [];
    for (const o of opts.operands) {
      const st = statArg(ctx, o);
      if (typeof st === 'string') {
        ctx.err(`df: ${o}: ${errorText(st)}\n`);
        continue;
      }
      const p = st.path;
      const best = rows.filter((r) => p === r.mount || p.startsWith(r.mount === '/' ? '/' : r.mount + '/')).sort((a, b) => b.mount.length - a.mount.length)[0];
      shown.push(best);
    }
    if (!shown.length) return 1;
  }
  const n = (kb: number) => (f.has('h') ? human(kb * 1024) : String(kb));
  const head = f.has('h') ? 'Size' : '1K-blocks';
  const lines = [[`Filesystem`, ...(f.has('T') ? ['Type'] : []), head, 'Used', 'Avail', 'Use%', 'Mounted on']];
  for (const r of shown) {
    const pct = r.size ? `${Math.ceil((r.used / r.size) * 100)}%` : '-';
    lines.push([r.fs, ...(f.has('T') ? [r.type] : []), n(r.size), n(r.used), n(Math.max(0, r.size - r.used)), pct, r.mount]);
  }
  const widths = lines[0].map((_c, k) => Math.max(...lines.map((l) => l[k].length)));
  ctx.out(lines.map((l) => l.map((c, k) => (k === 0 || k === l.length - 1 || (f.has('T') && k === 1) ? c.padEnd(widths[k]) : c.padStart(widths[k]))).join(' ').trimEnd()).join('\n') + '\n');
  return 0;
};

export const du: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'ahsckbmxSL',
    withValue: 'd',
    long: { all: 'a', 'human-readable': 'h', summarize: 's', total: 'c', bytes: 'b', 'max-depth': 'd', 'apparent-size': 'b' },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const maxDepth = opts.values.has('d') ? Number(opts.values.get('d')) : f.has('s') ? 0 : Infinity;
  if (Number.isNaN(maxDepth)) return usage(ctx, `invalid maximum depth ${lq(opts.values.get('d')!)}`);
  // Disk usage in bytes: 4 KiB blocks, unless -b asks for apparent sizes.
  const blocks = (size: number) => (f.has('b') ? size : Math.ceil(size / 4096) * 4096);
  const show = (bytes: number) => (f.has('h') ? human(f.has('b') ? bytes : Math.ceil(bytes / 1024) * 1024) : f.has('b') ? String(bytes) : f.has('m') ? String(Math.ceil(bytes / 1048576)) : String(Math.ceil(bytes / 1024)));
  let total = 0;
  let status = 0;
  const walk = (path: string, shown: string, depth: number): number => {
    ctx.tick();
    const st = ctx.fs.stat(path)!;
    if (st.type === 'file') {
      const b = blocks(st.size);
      if (depth === 0 || (f.has('a') && depth <= maxDepth)) ctx.out(`${show(b)}\t${shown}\n`);
      return b;
    }
    let sum = 4096;
    if (!ctx.fs.isSystem(path)) for (const c of ctx.fs.list(path)) sum += walk(c.path, join(shown, c.path.slice(c.path.lastIndexOf('/') + 1)), depth + 1);
    if (depth <= maxDepth) ctx.out(`${show(sum)}\t${shown}\n`);
    return sum;
  };
  for (const o of opts.operands.length ? opts.operands : ['.']) {
    const st = statArg(ctx, o);
    if (typeof st === 'string') {
      ctx.err(`du: cannot access ${lq(o)}: ${errorText(st)}\n`);
      status = 1;
      continue;
    }
    total += walk(abs(ctx, o), o, 0);
  }
  if (f.has('c')) ctx.out(`${show(total)}\ttotal\n`);
  return status;
};

// ---- manual ------------------------------------------------------------------------------

/** One-line descriptions, as the NAME section of each manual page has them. */
export const WHATIS: Record<string, string> = {
  awk: 'pattern scanning and text processing language', base64: 'base64 encode/decode data and print to standard output',
  basename: 'strip directory and suffix from filenames', bash: 'GNU Bourne-Again SHell', bc: 'An arbitrary precision calculator language',
  cat: 'concatenate files and print on the standard output', chmod: 'change file mode bits', cksum: 'compute and verify file checksums',
  clear: 'clear the terminal screen', cmp: 'compare two files byte by byte', column: 'columnate lists', comm: 'compare two sorted files line by line',
  cp: 'copy files and directories', curl: 'transfer a URL', cut: 'remove sections from each line of files', date: 'print or set the system date and time',
  df: 'report file system space usage', diff: 'compare files line by line', dirname: 'strip last component from file name',
  du: 'estimate file space usage', echo: 'display a line of text', env: 'run a program in a modified environment', expr: 'evaluate expressions',
  false: 'do nothing, unsuccessfully', file: 'determine file type', find: 'search for files in a directory hierarchy', fold: 'wrap each input line to fit in specified width',
  free: 'Display amount of free and used memory in the system', grep: 'print lines that match patterns', groups: 'print the groups a user is in',
  gunzip: 'compress or expand files', gzip: 'compress or expand files', head: 'output the first part of files', hexdump: 'display file contents in hexadecimal, decimal, octal, or ascii',
  hostname: 'show or set the system\'s host name', id: 'print real and effective user and group IDs', kill: 'send a signal to a process',
  less: 'opposite of more', ln: 'make links between files', ls: 'list directory contents', lsb_release: 'print distribution-specific information',
  man: 'an interface to the system reference manuals', md5sum: 'compute and check MD5 message digest', mkdir: 'make directories', mktemp: 'create a temporary file or directory',
  more: 'display the contents of a file in a terminal', mv: 'move (rename) files', nano: 'Nano\'s ANOther editor, inspired by Pico', nl: 'number lines of files',
  nohup: 'run a command immune to hangups, with output to a non-tty', nproc: 'print the number of processing units available', od: 'dump files in octal and other formats',
  paste: 'merge lines of files', pgrep: 'look up, signal, or wait for processes based on name and other attributes', pkill: 'look up, signal, or wait for processes based on name and other attributes',
  printenv: 'print all or part of environment', printf: 'format and print data', ps: 'report a snapshot of the current processes.', pwd: 'print name of current/working directory',
  readlink: 'print resolved symbolic links or canonical file names', realpath: 'print the resolved path', rev: 'reverse lines characterwise', rm: 'remove files or directories',
  rmdir: 'remove empty directories', sed: 'stream editor for filtering and transforming text', seq: 'print a sequence of numbers', sh: 'command interpreter (shell)',
  sha1sum: 'compute and check SHA1 message digest', sha256sum: 'compute and check SHA256 message digest', shuf: 'generate random permutations', sleep: 'delay for a specified amount of time',
  sort: 'sort lines of text files', sqlite3: 'A command line interface for SQLite version 3', stat: 'display file or file system status', strings: 'print the sequences of printable characters in files',
  su: 'run a command with substitute user and group ID', sudo: 'execute a command as another user', tac: 'concatenate and print files in reverse', tail: 'output the last part of files',
  tar: 'an archiving utility', tee: 'read from standard input and write to standard output and files', test: 'check file types and compare values', timeout: 'run a command with a time limit',
  top: 'display Linux processes', touch: 'change file timestamps', tput: 'initialize a terminal or query terminfo database', tr: 'translate or delete characters', tree: 'list contents of directories in a tree-like format.',
  true: 'do nothing, successfully', tty: 'print the file name of the terminal connected to standard input', uname: 'print system information', uniq: 'report or omit repeated lines',
  uptime: 'Tell how long the system has been running.', users: 'print the user names of users currently logged in to the current host', vi: 'Vi IMproved, a programmer\'s text editor',
  vim: 'Vi IMproved, a programmer\'s text editor', w: 'Show who is logged on and what they are doing.', wc: 'print newline, word, and byte counts for each file', websearch: 'search the web from the terminal',
  which: 'locate a command', who: 'show who is logged on', whoami: 'print effective user name', xargs: 'build and execute command lines from standard input', xxd: 'make a hex dump or do the reverse.',
  yes: 'output a string repeatedly until killed', zcat: 'compress or expand files', arch: 'print machine hardware name (same as uname -m)', killall: 'kill processes by name',
};

export const man: Command = (ctx) => {
  const args = ctx.args.filter((a) => !/^-[a-zA-Z]*$/.test(a) || a === '-k' || a === '-f');
  if (args[0] === '-k' || args[0] === '-f') {
    const q = (args[1] ?? '').toLowerCase();
    if (!q) {
      ctx.err(`${args[0] === '-k' ? 'apropos' : 'whatis'} what?\n`);
      return 1;
    }
    const hits = Object.entries(WHATIS).filter(([n, d]) => (args[0] === '-f' ? n === q : n.includes(q) || d.toLowerCase().includes(q))).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!hits.length) {
      ctx.err(`${q}: nothing appropriate.\n`);
      return 16;
    }
    for (const [n, d] of hits) ctx.out(`${n.padEnd(15)} (1)  - ${d}\n`);
    return 0;
  }
  const pages = args.filter((a) => !/^\d$/.test(a));
  if (!pages.length) {
    ctx.err('What manual page do you want?\nFor example, try \'man man\'.\n');
    return 1;
  }
  let status = 0;
  for (const name of pages) {
    const desc = WHATIS[name];
    if (!desc) {
      ctx.err(`No manual entry for ${name}\n`);
      status = 16;
      continue;
    }
    const title = `${name.toUpperCase()}(1)`;
    const head = `${title}${'User Commands'.padStart(40 - title.length + 6).padEnd(66 - title.length)}${title}\n\n`;
    let body = `NAME\n       ${name} - ${desc}\n\n`;
    const help = name === 'man' ? null : ctx.capture([name, '--help'], '');
    const text = help && help.status === 0 ? help.stdout.trim() : '';
    if (text && !text.startsWith(`${name}: unrecognized option`)) {
      const lines = text.split('\n');
      const synopsis = lines[0].startsWith('Usage:') ? lines.shift()!.replace(/^Usage:\s*/, '') : name;
      body += `SYNOPSIS\n       ${synopsis}\n\nDESCRIPTION\n${lines.map((l) => (l.trim() ? '       ' + l.trim() : '')).join('\n').replace(/^\n+/, '')}\n\n`;
    } else body += `SYNOPSIS\n       ${name} [OPTION]... [FILE]...\n\n`;
    body += `SEE ALSO\n       Full documentation is not installed on this machine; try ${name} --help.\n\n`;
    ctx.out(head + body + `GNU coreutils 9.4${' '.repeat(28)}November 2026${' '.repeat(20)}${title}\n`);
  }
  return status;
};

export const whatis: Command = (ctx) => {
  let status = 0;
  for (const n of ctx.args) {
    const d = WHATIS[n];
    if (d) ctx.out(`${n.padEnd(15)} (1)  - ${d}\n`);
    else {
      ctx.err(`${n}: nothing appropriate.\n`);
      status = 16;
    }
  }
  return status;
};

export const apropos: Command = (ctx) => man({ ...ctx, args: ['-k', ...ctx.args] });
