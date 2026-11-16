// The parts of a Linux machine that are not the user's files: /dev, /proc, /bin and /usr/bin are
// generated and read-only; /etc, /tmp and /var are ordinary files the host seeds once (seedSystem),
// so both the browser and the server start from the same tree.

import type { Device, MemoryVfs } from './vfs.ts';
import { COMMANDS } from './commands/index.ts';
import type { VirtualShell } from './shell.ts';
import { PID } from './shell.ts';

export const HOSTNAME = '755';
export const KERNEL = '6.8.0-49-generic';
export const KERNEL_VERSION = '#49-Ubuntu SMP PREEMPT_DYNAMIC Sun Nov  3 14:42:17 UTC 2024';
export const OS_PRETTY = 'Ubuntu 24.04.1 LTS';

export const MEM_TOTAL_KB = 2_048_000;

/** Looks like an executable when someone cats it. */
function elf(name: string): () => string {
  return () => `\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x03\0>\0\x01\0\0\0/lib64/ld-linux-x86-64.so.2\0GLIBC_2.34\0${name}\0__libc_start_main\0`;
}

/** Programs that are part of bash itself, not files in /usr/bin. */
const SHELL_ONLY = new Set(['cd', 'clear', 'help', 'edit']);

/** Seconds the machine has been up: a little over three days, moving with the clock. */
export function uptimeSeconds(now: number): number {
  return 3 * 86400 + 4 * 3600 + 17 * 60 + (Math.floor((now % 86_400_000) / 1000) % 600);
}

/** Adds /dev, /proc, /bin and /usr/bin to a shell's filesystem. */
export function installSystem(sh: VirtualShell): void {
  const fs = sh.fs;
  fs.addSystemDir('/dev', {
    null: 'null', zero: 'zero', random: 'random', urandom: 'random', full: 'full', tty: 'tty',
    stdin: 'tty', stdout: 'tty', stderr: 'tty', console: 'tty',
    // The disk itself; df and fstab name the partition the home folder is on, /dev/vda1.
    sda: 'disk', sda1: 'disk', sda2: 'disk', vda: 'disk', vda1: 'disk',
    fd: { '0': 'tty', '1': 'tty', '2': 'tty' },
    shm: {},
  });
  const self = (): Record<string, Device> => ({
    status: () =>
      `Name:\tbash\nUmask:\t${sh.umask.toString(8).padStart(4, '0')}\nState:\tR (running)\nTgid:\t${PID}\nPid:\t${PID}\nPPid:\t1\n` +
      `Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nVmRSS:\t    5120 kB\nThreads:\t1\n`,
    cmdline: () => 'bash\0',
    comm: () => 'bash\n',
    environ: () => Object.entries(sh.environment()).map(([k, v]) => `${k}=${v}\0`).join(''),
  });
  fs.addSystemDir('/proc', {
    cpuinfo: () =>
      [0, 1]
        .map(
          (n) =>
            `processor\t: ${n}\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel\t\t: 85\nmodel name\t: Intel(R) Xeon(R) Platinum 8175M CPU @ 2.50GHz\n` +
            `stepping\t: 4\ncpu MHz\t\t: 2499.998\ncache size\t: 33792 KB\nphysical id\t: 0\nsiblings\t: 2\ncore id\t\t: ${n}\ncpu cores\t: 2\n` +
            `flags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ss ht syscall nx pdpe1gb rdtscp lm constant_tsc rep_good nopl xtopology nonstop_tsc cpuid pni pclmulqdq ssse3 fma cx16 pcid sse4_1 sse4_2 x2apic movbe popcnt aes xsave avx f16c rdrand hypervisor lahf_lm abm 3dnowprefetch avx2 avx512f\n` +
            `bogomips\t: 4999.99\naddress sizes\t: 46 bits physical, 48 bits virtual\n\n`,
        )
        .join(''),
    meminfo: () => {
      const used = 640_000 + (sh.fs.usage().bytes >> 10);
      return (
        `MemTotal:       ${MEM_TOTAL_KB} kB\nMemFree:        ${MEM_TOTAL_KB - used - 712_000} kB\nMemAvailable:   ${MEM_TOTAL_KB - used} kB\n` +
        `Buffers:           42112 kB\nCached:           670008 kB\nSwapCached:            0 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n`
      );
    },
    version: () => `Linux version ${KERNEL} (buildd@lcy02-amd64-116) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0, GNU ld (GNU Binutils for Ubuntu) 2.42) ${KERNEL_VERSION}\n`,
    uptime: () => {
      const s = uptimeSeconds(sh.state.now());
      return `${s}.42 ${(s * 1.7).toFixed(2)}\n`;
    },
    loadavg: () => `0.08 0.03 0.01 1/97 ${PID + 1}\n`,
    mounts: () =>
      'overlay / overlay rw,relatime 0 0\nproc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\ntmpfs /dev tmpfs rw,nosuid,size=65536k,mode=755 0 0\n' +
      `/dev/vda1 ${sh.home} ext4 rw,relatime 0 0\n`,
    filesystems: () => 'nodev\tsysfs\nnodev\ttmpfs\nnodev\tproc\nnodev\toverlay\n\text4\n',
    cmdline: () => 'BOOT_IMAGE=/vmlinuz-6.8.0-49-generic root=/dev/vda1 ro console=ttyS0\n',
    stat: () => 'cpu  10132 0 3384 2318841 1012 0 125 0 0 0\n',
    self: self(),
    [String(PID)]: self(),
    '1': { status: () => 'Name:\tbash\nState:\tS (sleeping)\nPid:\t1\nPPid:\t0\n', cmdline: () => '/bin/bash\0', comm: () => 'bash\n' },
    sys: { kernel: { hostname: () => sh.state.hostname + '\n', ostype: () => 'Linux\n', osrelease: () => KERNEL + '\n' } },
  });
  const bin: Record<string, Device> = {};
  for (const name of Object.keys(COMMANDS)) if (!SHELL_ONLY.has(name)) bin[name] = elf(name);
  for (const name of ['bash', 'sh', 'dash', 'env', 'test', '[']) bin[name] = elf(name);
  fs.addSystemDir('/bin', bin);
  if (fs.isDir('/usr')) fs.addSystemDir('/usr/bin', bin);
}

/** True when `name` has a file in /usr/bin. */
export function inPath(name: string): boolean {
  return (Object.prototype.hasOwnProperty.call(COMMANDS, name) && !SHELL_ONLY.has(name)) || ['bash', 'sh', 'env', 'test', '['].includes(name);
}

export interface SystemOptions {
  user?: string;
  home?: string;
  hostname?: string;
}

/**
 * The ordinary system files of the machine: /etc, /tmp, /var, /usr, /root. Seeded once by whoever
 * builds the machine, and then they are files like any other.
 */
export function seedSystem(fs: MemoryVfs, opts: SystemOptions = {}): void {
  const user = opts.user ?? 'worker';
  const home = opts.home ?? `/home/${user}`;
  const host = opts.hostname ?? HOSTNAME;
  for (const d of ['/etc', '/tmp', '/var/log', '/var/tmp', '/var/lib', '/usr/local/bin', '/usr/share', '/usr/lib', '/opt', '/root', '/mnt', '/srv']) {
    fs.mkdir(d, { recursive: true });
  }
  fs.chmod('/tmp', 0o1777);
  fs.chmod('/var/tmp', 0o1777);
  fs.chmod('/root', 0o700);
  const files: Record<string, string> = {
    '/etc/hostname': host + '\n',
    '/etc/hosts': `127.0.0.1\tlocalhost\n127.0.1.1\t${host}\n::1\tlocalhost ip6-localhost ip6-loopback\n`,
    '/etc/passwd':
      'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\n' +
      'sys:x:3:3:sys:/dev:/usr/sbin/nologin\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n' +
      `${user}:x:1000:1000:${user}:${home}:/bin/bash\n`,
    '/etc/group': `root:x:0:\nadm:x:4:\nsudo:x:27:\nwww-data:x:33:\nusers:x:100:\n${user}:x:1000:\n`,
    '/etc/shells': '# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n',
    '/etc/os-release':
      `PRETTY_NAME="${OS_PRETTY}"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\n` +
      'HOME_URL="https://www.ubuntu.com/"\nUBUNTU_CODENAME=noble\n',
    '/etc/issue': `${OS_PRETTY} \\n \\l\n\n`,
    '/etc/timezone': 'Etc/UTC\n',
    '/etc/resolv.conf': 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n',
    '/etc/fstab': '# <file system> <mount point> <type> <options> <dump> <pass>\n/dev/vda1 / ext4 defaults 0 1\n',
    '/etc/profile': '# /etc/profile: system-wide .profile file for the Bourne shell\nif [ "${PS1-}" ]; then\n  PS1=\'\\u@\\h:\\w\\$ \'\nfi\n',
    '/etc/bash.bashrc': '# System-wide .bashrc file for interactive bash(1) shells.\n[ -z "$PS1" ] && return\nshopt -s checkwinsize\n',
    '/etc/environment': 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n',
    '/var/log/syslog': '',
  };
  for (const [path, content] of Object.entries(files)) fs.writeFile(path, content);
  fs.chmod('/var/log/syslog', 0o640);
}
