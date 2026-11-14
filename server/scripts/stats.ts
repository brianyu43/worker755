// Prints the daily counts the server keeps in DATA_DIR/stats (src/stats.ts).
//   node server/scripts/stats.ts [days]      default: the last 7
// In the container: docker compose exec game node server/scripts/stats.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DayStats } from '../src/stats.ts';

const dir = join(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname, 'stats');
const days = Number(process.argv[2] ?? 7);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().slice(-days);

for (const f of files) {
  const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DayStats;
  const c = d.counts;
  const top = (kind: string, n = 12) =>
    Object.entries(c)
      .filter(([k]) => k.startsWith(`${kind}:`))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k.slice(kind.length + 1)} ${v}`)
      .join(', ');
  console.log(`\n${f.slice(0, 10)}  visitors ${d.visitors}  shifts ${c['shift:start'] ?? 0} started, ${c['shift:end'] ?? 0} finished, ${c.share ?? 0} shared`);
  for (const kind of ['view', 'ref', 'source', 'access', 'free', 'model', 'persona', 'workplace', 'language', 'lang', 'device']) {
    const line = top(kind);
    if (line) console.log(`  ${kind.padEnd(10)} ${line}`);
  }
}
