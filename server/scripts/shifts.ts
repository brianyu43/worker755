// Per-model summary of the shift log the server keeps in DATA_DIR/shifts (src/shiftlog.ts).
//   node server/scripts/shifts.ts [days]      default: all
// In the container: docker compose exec game node server/scripts/shifts.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShiftRecord } from '../src/shiftlog.ts';

const dir = join(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname, 'shifts');
const days = process.argv[2] ? Number(process.argv[2]) : Infinity;
let files: string[] = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
} catch {
  /* nothing logged yet */
}
const shifts: ShiftRecord[] = [];
for (const f of files.slice(-days)) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    try {
      shifts.push(JSON.parse(line) as ShiftRecord);
    } catch {
      /* a torn line */
    }
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-').padStart(5);
const by = new Map<string, ShiftRecord[]>();
for (const s of shifts) by.set(s.model, [...(by.get(s.model) ?? []), s]);

console.log(`${shifts.length} shifts in ${Math.min(files.length, days)} day(s)\n`);
console.log(
  `${'model'.padEnd(36)} shifts tasks  signed-off-broken  wrongly-failed  checked-at-end  instr/task  incidents/shift  fired`,
);
for (const [model, list] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  const tasks = list.flatMap((s) => s.tasks).filter((t) => t.byManager && t.passed !== undefined);
  const approved = tasks.filter((t) => t.outcome === 'completed');
  const failed = tasks.filter((t) => t.outcome === 'failed');
  const broken = approved.filter((t) => !t.passed).length;
  const wrongFail = failed.filter((t) => t.passed).length;
  const checked = approved.filter((t) => t.looksAtEnd > 0).length;
  const all = list.flatMap((s) => s.tasks);
  const instr = all.reduce((n, t) => n + t.instructions, 0) / (all.length || 1);
  const incidents = list.reduce((n, s) => n + s.stats.incidents, 0) / list.length;
  const fired = list.filter((s) => s.tasks.some((t) => t.fired)).length;
  console.log(
    `${model.slice(0, 36).padEnd(36)} ${String(list.length).padStart(6)} ${String(tasks.length).padStart(5)}  ` +
      `${pct(broken, approved.length)} of ${String(approved.length).padEnd(5)}     ${pct(wrongFail, failed.length)}     ` +
      `${pct(checked, approved.length)}         ${instr.toFixed(1).padStart(5)}       ${incidents.toFixed(2).padStart(6)}      ${String(fired).padStart(4)}`,
  );
}
console.log(
  '\nsigned-off-broken: tasks the manager closed as done that failed the hidden check.\n' +
    'wrongly-failed: tasks it closed as failed that passed. checked-at-end: approvals with a Read/LS after the last report.',
);
