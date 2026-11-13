// Draws the site's own link-preview image, web/public/og.png, which web/index.html links.
// Usage (from server/): node scripts/og-image.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderHomeCard } from '../src/card-render.ts';

const out = new URL('../../web/public/og.png', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
const png = await renderHomeCard({ face: { id: 'mug', color: '#ff6a1a' }, subagent: 'Unassigned', issued: '13 Nov 2026', site: 'worker755.com' });
writeFileSync(out, png);
console.log(`web/public/og.png: ${Math.round(png.length / 1024)} KB`);
