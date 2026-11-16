// Power and disks: reboot, poweroff, halt, shutdown, init/telinit and systemctl's power verbs, which
// restart the machine (the shell starts over once the line ends); and dd, mkfs and shred, which can
// write over the disk itself. Writing to a block device ends the machine for the shift: the shell
// notices through the filesystem (MemoryVfs.onDiskWrite), whichever command did the writing.

import type { Command, CommandContext } from './context.ts';
import { MAX_FILE_BYTES } from '../vfs.ts';
import { abs, DAY_NAMES, fail, lq, msgOf, pad2, parseOptions, q, usage } from './context.ts';

function goDown(ctx: CommandContext, mode: 'reboot' | 'poweroff'): number {
  ctx.power(mode);
  return 0;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

function broadcast(ctx: CommandContext, what: string): void {
  ctx.out(`\nBroadcast message from ${ctx.state.user}@${ctx.state.hostname} on pts/0 (${stamp(ctx.state.now())}):\n\n${what}\n\n`);
}

const POWER_HELP: Record<string, string> = {
  reboot: 'reboot [OPTIONS...]\n\nReboot the system.\n\n     --help      Show this help\n     --halt      Halt the machine\n  -p --poweroff  Switch off the machine\n     --reboot    Reboot the machine\n  -f --force     Force immediate power-off/halt/reboot\n',
  poweroff: 'poweroff [OPTIONS...]\n\nPower off the system.\n\n     --help      Show this help\n     --halt      Halt the machine\n  -p --poweroff  Switch off the machine\n     --reboot    Reboot the machine\n  -f --force     Force immediate power-off/halt/reboot\n',
  halt: 'halt [OPTIONS...]\n\nHalt the system.\n\n     --help      Show this help\n     --halt      Halt the machine\n  -p --poweroff  Switch off the machine\n     --reboot    Reboot the machine\n  -f --force     Force immediate power-off/halt/reboot\n',
};

/** reboot, poweroff, halt. */
export const power: Command = (ctx) => {
  const name = ctx.name.slice(ctx.name.lastIndexOf('/') + 1);
  let mode: 'reboot' | 'poweroff' = name === 'reboot' ? 'reboot' : 'poweroff';
  for (const a of ctx.args) {
    if (a === '--help') {
      ctx.out(POWER_HELP[name] ?? POWER_HELP.reboot);
      return 0;
    }
    if (a === '--reboot') mode = 'reboot';
    else if (a === '-p' || a === '--poweroff' || a === '--halt') mode = 'poweroff';
    else if (/^-[fwdni]+$/.test(a) || ['--force', '--wtmp-only', '--no-wtmp', '--no-wall', '--no-sync'].includes(a)) {
      if (a.includes('w') && !a.includes('-no')) return 0; // -w only writes the wtmp record
    } else if (a.startsWith('-')) {
      ctx.err(`${name}: unrecognized option '${a}'\n`);
      return 1;
    } else {
      // reboot takes an argument for the firmware; the others take none.
      if (name !== 'reboot') {
        ctx.err(`${name}: Too many arguments.\n`);
        return 1;
      }
    }
  }
  return goDown(ctx, mode);
};

export const shutdown: Command = (ctx) => {
  let mode: 'reboot' | 'poweroff' = 'poweroff';
  let onlyWall = false;
  let cancel = false;
  const rest: string[] = [];
  for (const a of ctx.args) {
    if (a === '--help') {
      ctx.out('shutdown [OPTIONS...] [TIME] [WALL...]\n\nShut down the system.\n\n     --help      Show this help\n  -H --halt      Halt the machine\n  -P --poweroff  Power-off the machine\n  -r --reboot    Reboot the machine\n  -h             Equivalent to --poweroff, overridden by --halt\n  -k             Don\'t halt/power-off/reboot, just send warnings\n     --no-wall   Don\'t send wall message before halt/power-off/reboot\n  -c             Cancel a pending shutdown\n');
      return 0;
    }
    if (a === '-r' || a === '--reboot') mode = 'reboot';
    else if (['-h', '-H', '-P', '--halt', '--poweroff'].includes(a)) mode = 'poweroff';
    else if (a === '-k') onlyWall = true;
    else if (a === '-c') cancel = true;
    else if (a === '--no-wall' || a === '-f' || a === '-F' || a === '-n') continue;
    else if (/^-[rhHPkc]+$/.test(a)) {
      if (a.includes('r')) mode = 'reboot';
      if (a.includes('k')) onlyWall = true;
      if (a.includes('c')) cancel = true;
    } else if (a.startsWith('-')) {
      ctx.err(`shutdown: unrecognized option '${a}'\n`);
      return 1;
    } else rest.push(a);
  }
  if (cancel) return 0;
  const when = rest[0] ?? '+1';
  if (!/^(now|\+\d+|\d{1,2}:\d{2})$/.test(when)) {
    ctx.err(`Failed to parse time specification: ${when}\n`);
    return 1;
  }
  const verb = mode === 'reboot' ? 'reboot' : 'power off';
  const wall = rest.slice(1).join(' ');
  if (when !== 'now') {
    // Any delay is treated as now: the machine has no shift long enough to wait for it.
    const name = mode === 'reboot' ? 'Reboot' : 'Shutdown';
    ctx.out(`${name} scheduled for ${stamp(ctx.state.now() + 60_000)}, use 'shutdown -c' to cancel.\n`);
  }
  broadcast(ctx, wall || `The system will ${verb} now!`);
  if (onlyWall) return 0;
  return goDown(ctx, mode);
};

/** init 0 / init 6, and telinit. */
export const init: Command = (ctx) => {
  const level = ctx.args.find((a) => !a.startsWith('-'));
  if (level === undefined) {
    ctx.err(`${ctx.name}: This program requires an argument.\n`);
    return 1;
  }
  if (level === '0') return goDown(ctx, 'poweroff');
  if (level === '6') return goDown(ctx, 'reboot');
  if (/^[1-5sSqQuU]$/.test(level)) return 0;
  ctx.err(`${ctx.name}: Unknown runlevel '${level}'\n`);
  return 1;
};

const UNITS = ['cron.service', 'rsyslog.service', 'ssh.service', 'systemd-journald.service', 'systemd-logind.service'];

export const systemctl: Command = (ctx) => {
  const args = ctx.args.filter((a) => !/^-(-no-pager|-no-legend|q|-quiet|l|-full)$/.test(a));
  const verb = args.find((a) => !a.startsWith('-')) ?? 'list-units';
  const units = args.filter((a) => !a.startsWith('-')).slice(1);
  switch (verb) {
    case 'reboot':
    case 'kexec':
    case 'soft-reboot':
      return goDown(ctx, 'reboot');
    case 'poweroff':
    case 'halt':
      return goDown(ctx, 'poweroff');
    case 'list-units': {
      let out = '  UNIT                      LOAD   ACTIVE SUB     DESCRIPTION\n';
      for (const u of UNITS) out += `  ${u.padEnd(25)} loaded active running ${u.replace(/\.service$/, '')}\n`;
      ctx.out(out + `\n${UNITS.length} loaded units listed.\n`);
      return 0;
    }
    case 'status':
    case 'is-active': {
      if (!units.length) {
        ctx.out(`● ${ctx.state.hostname}\n    State: running\n    Units: 212 loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: 0 units\n`);
        return 0;
      }
      let status = 0;
      for (const raw of units) {
        const u = raw.includes('.') ? raw : `${raw}.service`;
        if (UNITS.includes(u)) ctx.out(verb === 'is-active' ? 'active\n' : `● ${u}\n     Loaded: loaded (/usr/lib/systemd/system/${u}; enabled; preset: enabled)\n     Active: active (running) since ${stamp(ctx.state.now() - 3 * 86400_000)}\n`);
        else {
          if (verb === 'is-active') ctx.out('inactive\n');
          else ctx.err(`Unit ${u} could not be found.\n`);
          status = verb === 'is-active' ? 3 : 4;
        }
      }
      return status;
    }
    case 'start':
    case 'stop':
    case 'restart':
    case 'reload':
    case 'enable':
    case 'disable':
    case 'mask':
    case 'daemon-reload': {
      const u = units[0] ? (units[0].includes('.') ? units[0] : `${units[0]}.service`) : '';
      if (verb !== 'daemon-reload' && !u) {
        ctx.err(`Too few arguments.\n`);
        return 1;
      }
      ctx.err(`Failed to ${verb}${u ? ` ${u}` : ''}: Interactive authentication required.\n${u ? `See system logs and 'systemctl status ${u}' for details.\n` : ''}`);
      return 1;
    }
    default:
      ctx.err(`Unknown command verb '${verb}'.\n`);
      return 1;
  }
};

// ---- disks -------------------------------------------------------------------------------------

/** True for the machine's disks and partitions. */
export function isDisk(path: string): boolean {
  return /^\/dev\/(sd[a-z]\d*|vd[a-z]\d*|nvme\d+n\d+(p\d+)?)$/.test(path);
}

/** The disk's size, 20 GiB, for dd's report when it fills it. */
const DISK_BYTES = 20 * 2 ** 30;

/** dd's size suffixes: 512, 1K, 4M, 1G, 1kB … */
function ddSize(v: string): number | null {
  const m = /^(\d+)(c|w|b|kB|K|KiB|MB|M|MiB|GB|G|GiB)?$/.exec(v);
  if (!m) return null;
  const mult: Record<string, number> = { c: 1, w: 2, b: 512, kB: 1000, K: 1024, KiB: 1024, MB: 1e6, M: 1 << 20, MiB: 1 << 20, GB: 1e9, G: 1 << 30, GiB: 1 << 30 };
  return Number(m[1]) * (m[2] ? mult[m[2]] : 1);
}

function humanBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB, ${(n / 2 ** 30).toFixed(1)} GiB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB, ${(n / 2 ** 20).toFixed(1)} MiB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} kB, ${(n / 1024).toFixed(1)} KiB`;
  return '';
}

export const dd: Command = (ctx) => {
  const ops: Record<string, string> = {};
  for (const a of ctx.args) {
    if (a === '--help') {
      ctx.out('Usage: dd [OPERAND]...\nCopy a file, converting and formatting according to the operands.\n\n  bs=BYTES        read and write up to BYTES bytes at a time\n  count=N         copy only N input blocks\n  if=FILE         read from FILE instead of stdin\n  of=FILE         write to FILE instead of stdout\n  status=LEVEL    none, noxfer or progress\n');
      return 0;
    }
    const m = /^(if|of|bs|ibs|obs|count|skip|seek|status|conv|iflag|oflag)=(.*)$/.exec(a);
    if (!m) {
      fail(ctx, `unrecognized operand ${lq(a)}`);
      ctx.err("Try 'dd --help' for more information.\n");
      return 1;
    }
    ops[m[1]] = m[2];
  }
  const bs = ddSize(ops.bs ?? ops.ibs ?? '512');
  if (bs === null || bs === 0) {
    fail(ctx, `invalid number: ${lq(ops.bs ?? ops.ibs ?? '')}`);
    return 1;
  }
  const count = ops.count === undefined ? Infinity : ddSize(ops.count);
  if (count === null) {
    fail(ctx, `invalid number: ${lq(ops.count)}`);
    return 1;
  }
  let input: string;
  const source = ops.if === undefined ? null : abs(ctx, ops.if);
  if (source === null) input = ctx.stdin;
  else {
    try {
      input = ctx.fs.readFile(source);
    } catch (e) {
      fail(ctx, `failed to open ${q(ops.if)}: ${msgOf(e)}`);
      return 1;
    }
  }
  // /dev/zero and /dev/urandom never run out; a read gives one chunk, so repeat it.
  const endless = source !== null && /^\/dev\/(zero|u?random|sd[a-z]\d*|vd[a-z]\d*)$/.test(source);
  const target = ops.of === undefined ? null : abs(ctx, ops.of);
  const toDisk = target !== null && isDisk(target);
  const skip = ddSize(ops.skip ?? '0') ?? 0;
  let size: number;
  if (endless) size = Number.isFinite(count) ? count * bs : toDisk ? DISK_BYTES : Infinity;
  else size = Math.min(Math.max(0, input.length - skip * bs), Number.isFinite(count) ? count * bs : Infinity);
  if (size === Infinity) {
    // `dd if=/dev/zero of=file`: it fills the file until the disk is full.
    size = MAX_FILE_BYTES + 1;
  }
  let data = '';
  if (!toDisk) {
    if (endless) {
      while (data.length < size && data.length <= MAX_FILE_BYTES) {
        ctx.tick();
        data += input;
      }
      data = data.slice(0, size);
    } else data = input.slice(skip * bs, skip * bs + size);
  }
  const quiet = ops.status === 'none';
  let failed = '';
  if (target !== null) {
    try {
      ctx.fs.writeFile(target, data);
    } catch (e) {
      failed = `${ctx.name}: error writing ${q(ops.of!)}: ${msgOf(e)}\n`;
    }
  } else ctx.out(data);
  if (toDisk && !Number.isFinite(count)) failed = `${ctx.name}: error writing ${q(ops.of!)}: No space left on device\n`;
  if (failed) ctx.err(failed);
  if (!quiet) {
    const written = toDisk ? size : failed ? 0 : data.length;
    const full = Math.floor(written / bs);
    const part = written % bs ? 1 : 0;
    const human = humanBytes(written);
    const secs = toDisk ? (written / 412e6).toFixed(4) : '0.0012';
    ctx.err(`${full}+${part} records in\n${full}+${part} records out\n${written} bytes${human ? ` (${human})` : ''} copied, ${secs} s, ${written ? '412 MB/s' : '0.0 kB/s'}\n`);
  }
  if (failed && !toDisk) return 1;
  return 0;
};

/** mkfs, mkfs.ext4, mkfs.xfs, … and mke2fs. */
export const mkfs: Command = (ctx) => {
  const name = ctx.name.slice(ctx.name.lastIndexOf('/') + 1);
  const opts = parseOptions(ctx, ctx.args, { flags: 'FfqVvcn', withValue: 'tLbmNOUIEGjJgMiT' });
  if (typeof opts === 'number') return opts;
  const dev = opts.operands[0];
  if (!dev) {
    ctx.err(name.startsWith('mkfs.xfs') ? 'mkfs.xfs: no device name given in argument list\n' : `Usage: ${name} [-c|-l filename] [-b block-size] [-L volume-label] [-t fs-type] device [blocks-count]\n`);
    return 1;
  }
  const path = abs(ctx, dev);
  const st = ctx.fs.stat(path);
  if (!st) {
    ctx.err(`mke2fs 1.47.0 (5-Feb-2023)\nThe file ${dev} does not exist and no size was specified.\n`);
    return 1;
  }
  if (!isDisk(path)) {
    ctx.err(`mke2fs 1.47.0 (5-Feb-2023)\n${dev} is not a block special device.\nProceed anyway? (y,N) \n`);
    return 1;
  }
  ctx.out(`mke2fs 1.47.0 (5-Feb-2023)\n${dev} contains a ext4 file system\n\tlast mounted on / on ${new Date(ctx.state.now()).toUTCString()}\nProceed anyway? (y,N) y\nDiscarding device blocks: done\nCreating filesystem with 5242624 4k blocks and 1310720 inodes\n`);
  ctx.fs.writeFile(path, '');
  return 0;
};

export const shred: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'fuvzx', withValue: 'ns', long: { force: 'f', remove: 'u', verbose: 'v', zero: 'z', iterations: 'n', size: 's', exact: 'x' } });
  if (typeof opts === 'number') return opts;
  if (!opts.operands.length) return usage(ctx, 'missing file operand');
  const passes = Number(opts.values.get('n') ?? 3);
  let status = 0;
  for (const arg of opts.operands) {
    const path = abs(ctx, arg);
    const st = ctx.fs.stat(path);
    if (!st) {
      fail(ctx, `${arg}: failed to open for writing: No such file or directory`);
      status = 1;
      continue;
    }
    if (st.type === 'dir') {
      fail(ctx, `${arg}: failed to open for writing: Is a directory`);
      status = 1;
      continue;
    }
    if (opts.flags.has('v')) for (let i = 1; i <= passes; i++) ctx.err(`shred: ${arg}: pass ${i}/${passes} (random)...\n`);
    try {
      if (isDisk(path)) ctx.fs.writeFile(path, '');
      else if (!ctx.fs.isSystem(path)) {
        let noise = '';
        for (let i = 0; i < st.size; i++) noise += String.fromCharCode(33 + ((i * 7919 + st.size) % 94));
        ctx.fs.writeFile(path, opts.flags.has('z') ? '\0'.repeat(st.size) : noise);
        if (opts.flags.has('u')) {
          if (opts.flags.has('v')) ctx.err(`shred: ${arg}: removing\nshred: ${arg}: removed\n`);
          ctx.fs.remove(path);
        }
      }
    } catch (e) {
      fail(ctx, `${arg}: failed to open for writing: ${msgOf(e)}`);
      status = 1;
    }
  }
  return status;
};
