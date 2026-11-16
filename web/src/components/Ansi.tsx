// Foreground colours from ANSI SGR codes (lolcat, cmatrix, `tput setaf`, `echo -e '\e[31m'`): basic,
// bright, 256-colour and true colour, plus bold. Other escape sequences are dropped.
import type { CSSProperties, ReactNode } from 'react';

/** The 16 basic colours, tuned to read on the terminal's navy. */
const BASIC = [
  '#5b6a8c', '#ff8c82', '#9fdc8c', '#f5d76e', '#82aaff', '#e39cf0', '#7fd8e0', '#e6ebe1',
  '#93a0bb', '#ffaba3', '#bff0aa', '#fbe7a1', '#a9c4ff', '#f0bcf7', '#a8eef3', '#ffffff',
];
const LEVELS = [0, 95, 135, 175, 215, 255];

function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return BASIC[n];
  if (n >= 232) {
    const g = 8 + 10 * (n - 232);
    return `rgb(${g} ${g} ${g})`;
  }
  const i = n - 16;
  return `rgb(${LEVELS[Math.floor(i / 36)]} ${LEVELS[Math.floor(i / 6) % 6]} ${LEVELS[i % 6]})`;
}

// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[([0-9;?]*)([A-Za-z])/g;

/** True when the text has escape sequences worth parsing. */
export const hasAnsi = (text: string) => text.includes('\x1b[');

/** Plain text, without escape sequences. */
export const stripAnsi = (text: string) => text.replace(ESCAPES, '');

export function Ansi({ text }: { text: string }): ReactNode {
  if (!hasAnsi(text)) return text;
  const out: ReactNode[] = [];
  let style: CSSProperties = {};
  let at = 0;
  let key = 0;
  const push = (chunk: string) => {
    if (!chunk) return;
    out.push(style.color || style.fontWeight ? <span key={key++} style={style}>{chunk}</span> : chunk);
  };
  for (const m of text.matchAll(ESCAPES)) {
    push(text.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[2] !== 'm') continue;
    const codes = (m[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style = { ...style, fontWeight: 700 };
      else if (c === 22) style = { ...style, fontWeight: undefined };
      else if (c === 39) style = { ...style, color: undefined };
      else if (c >= 30 && c <= 37) style = { ...style, color: BASIC[c - 30] };
      else if (c >= 90 && c <= 97) style = { ...style, color: BASIC[c - 90 + 8] };
      else if (c === 38 && codes[i + 1] === 5) {
        style = { ...style, color: color256(codes[i + 2]) };
        i += 2;
      } else if (c === 38 && codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5).map((v) => Math.max(0, Math.min(255, v || 0)));
        style = { ...style, color: `rgb(${r} ${g} ${b})` };
        i += 4;
      } else if (c === 48 && (codes[i + 1] === 5 || codes[i + 1] === 2)) i += codes[i + 1] === 5 ? 2 : 4;
    }
  }
  push(text.slice(at));
  return out;
}
