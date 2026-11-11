import { createShell } from '../src/index.ts';

export const NOW = Date.UTC(2026, 10, 11, 10, 49, 0);

export function newShell() {
  const sh = createShell({ now: () => NOW });
  const run = (line: string) => sh.exec(line);
  return { sh, run };
}
