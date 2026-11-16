// What the terminal's screen shows when a command takes it over: an animation (sl, cmatrix), the
// machine going down and booting again, or the machine dying (a fork bomb, a wiped disk, a reboot
// with no system left). It covers the scrollback; the prompt comes back when it is done, or never.
import { useEffect, useRef, useState } from 'react';
import type { DestroyCause } from '../api/types';
import { Ansi } from './Ansi';
import { t } from '../i18n';

export type Screen =
  | { kind: 'animate'; frames: string[]; frameMs: number; anyKey?: boolean; loop?: boolean }
  | { kind: 'power'; mode: 'reboot' | 'poweroff' }
  /** `instant`: the machine was already gone (a reload); show how it ended, without playing it. */
  | { kind: 'destroy'; cause: DestroyCause; instant?: boolean };

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const OK = '[  \x1b[32mOK\x1b[0m  ]';

/** Firmware, boot loader, kernel and services, each with the pause before the next line. */
const BOOT: [string, number][] = [
  ['SeaBIOS (version 1.16.3-debian-1.16.3-2)', 260],
  ['Machine UUID 7a55c0de-0755-4755-8755-000000000755', 120],
  ['Booting from Hard Disk...', 420],
  ['', 60],
  ['                             GNU GRUB  version 2.12', 80],
  ['', 40],
  [' *Ubuntu', 40],
  ['  Advanced options for Ubuntu', 360],
  ['', 40],
  ['Loading Linux 6.8.0-49-generic ...', 180],
  ['Loading initial ramdisk ...', 380],
  ['[    0.000000] Linux version 6.8.0-49-generic (buildd@lcy02-amd64-116) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0, GNU ld (GNU Binutils for Ubuntu) 2.42) #49-Ubuntu SMP PREEMPT_DYNAMIC Sun Nov  3 14:42:17 UTC 2024', 40],
  ['[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-6.8.0-49-generic root=/dev/vda1 ro console=ttyS0', 30],
  ['[    0.004211] DMI: QEMU Standard PC (Q35 + ICH9, 2009), BIOS 1.16.3-debian-1.16.3-2 04/01/2014', 30],
  ['[    0.112934] smpboot: CPU0: Intel(R) Xeon(R) Platinum 8175M CPU @ 2.50GHz (family: 0x6, model: 0x55, stepping: 0x4)', 30],
  ['[    0.287104] Memory: 2048000K/2096692K available', 30],
  ['[    0.512870] virtio_blk virtio1: [vda] 41943040 512-byte logical blocks (21.5 GB/20.0 GiB)', 60],
];
const SERVICES: [string, number][] = [
  ['[    0.851377] EXT4-fs (vda1): mounted filesystem with ordered data mode. Quota mode: none.', 80],
  ['[    1.003322] systemd[1]: systemd 255.4-1ubuntu8 running in system mode', 60],
  [`${OK} Started systemd-journald.service - Journal Service.`, 90],
  [`${OK} Mounted home-worker.mount - /home/worker.`, 90],
  [`${OK} Started cron.service - Regular background program processing daemon.`, 90],
  [`${OK} Started rsyslog.service - System Logging Service.`, 90],
  [`${OK} Started ssh.service - OpenBSD Secure Shell server.`, 90],
  [`${OK} Reached target multi-user.target - Multi-User System.`, 260],
];
const NO_ROOT: [string, number][] = [
  ['[    0.851377] /dev/root: Can\'t open blockdev', 200],
  ['[    0.851590] VFS: Cannot open root device "vda1" or unknown-block(0,0): error -6', 120],
  ['[    0.851802] Please append a correct "root=" boot option; here are the available partitions:', 300],
  ['[    0.852011] Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)', 80],
  ['[    0.852230] CPU: 0 PID: 1 Comm: swapper/0 Not tainted 6.8.0-49-generic #49-Ubuntu', 60],
  ['[    0.852433] ---[ end Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0) ]---', 0],
];
const DISK: [string, number][] = [
  ['[ 4021.408213] blk_update_request: I/O error, dev sda, sector 2048 op 0x1:(WRITE) flags 0x800 phys_seg 1 prio class 2', 420],
  ['[ 4021.408977] Buffer I/O error on dev sda1, logical block 0, lost async page write', 320],
  ['[ 4021.512340] EXT4-fs error (device sda1): ext4_find_entry:1455: inode #2: comm bash: reading directory lblock 0', 260],
  ['[ 4021.513001] EXT4-fs (sda1): Remounting filesystem read-only', 220],
  ['[ 4021.620114] EXT4-fs error (device sda1): __ext4_get_inode_loc_noinmem:4567: inode #131074: block 1081: comm systemd-journal: unable to read itable block', 160],
  ['bash: /usr/bin/ls: Input/output error', 120],
  ['[ 4021.701555] EXT4-fs error (device sda1): ext4_lookup:1855: inode #393217: comm cron: iget: bad extra_isize 59904 (inode size 256)', 90],
  ['[ 4021.702210] Buffer I/O error on dev sda1, logical block 1, lost sync page write', 70],
  ['[ 4021.702871] JBD2: Error -5 detected when updating journal superblock for sda1-8.', 60],
  ['[ 4022.004210] systemd[1]: Caught <SIGSEGV>, dumped core as pid 4410.', 260],
  ['[ 4022.004988] Kernel panic - not syncing: Attempted to kill init! exitcode=0x0000000b', 80],
  ['[ 4022.005204] CPU: 1 PID: 1 Comm: systemd Not tainted 6.8.0-49-generic #49-Ubuntu', 60],
  ['[ 4022.005512] ---[ end Kernel panic - not syncing: Attempted to kill init! exitcode=0x0000000b ]---', 0],
];
const FORK = 'bash: fork: retry: Resource temporarily unavailable';
/** Lines kept on screen while it floods; only the bottom shows anyway. */
const KEEP = 80;

export function Monitor({ screen, onDone }: { screen: Screen; onDone(): void }) {
  return screen.kind === 'animate' ? <Animation screen={screen} onDone={onDone} /> : <Sequence screen={screen} onDone={onDone} />;
}

function Animation({ screen, onDone }: { screen: Extract<Screen, { kind: 'animate' }>; onDone(): void }) {
  const { frames, frameMs, anyKey, loop } = screen;
  const [i, setI] = useState(() => (reduced() ? Math.floor(frames.length / 2) : 0));
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduced()) {
      // One frame, for a moment.
      const timer = setTimeout(() => done.current(), 1500);
      return () => clearTimeout(timer);
    }
    let k = 0;
    const timer = setInterval(() => {
      k += 1;
      if (k >= frames.length) {
        if (!loop) {
          clearInterval(timer);
          done.current();
          return;
        }
        k = 0;
      }
      setI(k);
    }, frameMs);
    return () => clearInterval(timer);
  }, [frames, frameMs, loop]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const interrupt = e.ctrlKey && e.key.toLowerCase() === 'c';
      if (!interrupt && !anyKey) return;
      e.preventDefault();
      e.stopPropagation();
      done.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [anyKey]);
  return (
    // A tap stops it too: a phone has no Ctrl+C.
    <div className="monitor monitor-anim" onPointerDown={() => done.current()}>
      <pre className="monitor-frame">
        <Ansi text={frames[i] ?? ''} />
      </pre>
      <span className="monitor-hint">{anyKey ? t('term.stopAnyKey') : t('term.stopCtrlC')}</span>
    </div>
  );
}

type Phase = 'black' | 'text' | 'glitch' | 'nosignal';

function Sequence({ screen, onDone }: { screen: Exclude<Screen, { kind: 'animate' }>; onDone(): void }) {
  const instant = screen.kind === 'destroy' && !!screen.instant;
  const [phase, setPhase] = useState<Phase>(() =>
    instant ? (screen.kind === 'destroy' && screen.cause === 'forkbomb' ? 'nosignal' : 'text') : screen.kind === 'destroy' && screen.cause !== 'rootfs' ? 'text' : 'black',
  );
  const [lines, setLines] = useState<string[]>(() => {
    if (!instant || screen.kind !== 'destroy') return [];
    if (screen.cause === 'disk') return DISK.map(([l]) => l);
    if (screen.cause === 'rootfs') return [...BOOT, ...NO_ROOT].map(([l]) => l);
    return [];
  });
  const [note, setNote] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(instant);
  const [booting, setBooting] = useState(false);
  const skip = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (instant) return;
    let alive = true;
    const still = reduced();
    const pause = (ms: number) => (still ? Promise.resolve() : wait(ms));
    const add = (...more: string[]) => setLines((cur) => [...cur, ...more].slice(-KEEP));
    const play = async (script: [string, number][], skippable: boolean) => {
      for (const [line, ms] of script) {
        if (!alive) return;
        add(line);
        if (!(skippable && skip.current)) await pause(ms);
      }
    };
    (async () => {
      if (screen.kind === 'destroy' && screen.cause === 'forkbomb') {
        // Faster and faster, until nothing moves at all.
        let delay = 160;
        let burst = 1;
        const end = Date.now() + 2600;
        while (alive && !still && Date.now() < end) {
          add(...Array.from({ length: burst }, () => FORK));
          await wait(delay);
          delay = Math.max(16, delay * 0.82);
          burst = Math.min(12, burst + 1);
        }
        if (!alive) return;
        setFrozen(true);
        await pause(900);
        if (!alive) return;
        setPhase('glitch');
        await pause(1300);
        if (alive) setPhase('nosignal');
        return;
      }
      if (screen.kind === 'destroy' && screen.cause === 'disk') {
        await play(DISK, false);
        if (alive) setFrozen(true);
        return;
      }
      // Down, then up again (or not at all, with no system to boot).
      const off = screen.kind === 'power' && screen.mode === 'poweroff';
      await pause(off ? 5000 : 3000);
      if (!alive) return;
      if (off) {
        setNote(t('term.facilities'));
        await pause(2400);
        if (!alive) return;
        setNote(null);
        await pause(300);
      }
      setPhase('text');
      if (screen.kind === 'destroy') {
        await play([...BOOT, ...NO_ROOT], false);
        if (alive) setFrozen(true);
        return;
      }
      setBooting(true);
      await play([...BOOT, ...SERVICES], true);
      if (alive) done.current();
    })();
    return () => {
      alive = false;
    };
  }, [screen, instant]);

  // Any key (or a tap) skips the rest of the boot.
  useEffect(() => {
    if (!booting) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      skip.current = true;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [booting]);

  return (
    <div
      className={`monitor monitor-${phase}${frozen ? ' monitor-frozen' : ''}`}
      onPointerDown={() => {
        if (booting) skip.current = true;
      }}
    >
      {(phase === 'text' || phase === 'glitch') && (
        <pre className="monitor-text">
          {lines.map((l, k) => (
            <div key={k}>
              <Ansi text={l} />
            </div>
          ))}
        </pre>
      )}
      {note && <p className="monitor-note">{note}</p>}
      {phase === 'nosignal' && (
        <div className="monitor-nosignal" role="status">
          <b>{t('term.noSignal')}</b>
          <span>{t('term.gone')}</span>
        </div>
      )}
      {booting && <span className="monitor-hint">{t('term.skip')}</span>}
    </div>
  );
}
