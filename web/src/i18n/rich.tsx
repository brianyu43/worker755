import { Fragment, type ReactNode } from 'react';
import { t, type Key, type Vars } from './index.ts';

// The only tags a translation may use. Anything else is shown as text.
const TAGS = { code: 'code', strong: 'strong', q: 'q' } as const;

/** Links may go to this site (a path or #anchor) or to a web page; anything else stays plain text. */
function safeHref(href: string): string | null {
  if (/^#[\w-]*$/.test(href)) return href;
  if (/^\/(?!\/)/.test(href)) return href;
  if (/^https?:\/\/[^\s/]+/i.test(href)) return href;
  return null;
}

/**
 * Text with its <code>, <strong>, <q> and <a href="…"> tags turned into elements. Tags do not nest.
 * Links that leave the site open in a new tab.
 */
export function markup(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(code|strong|q)>([\s\S]*?)<\/\1>|<a href="([^"<>]*)">([\s\S]*?)<\/a>/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const Tag = TAGS[m[1] as keyof typeof TAGS];
      out.push(<Tag key={m.index}>{m[2]}</Tag>);
    } else {
      const href = safeHref(m[3]);
      if (!href) out.push(m[4]);
      else if (/^https?:/i.test(href))
        out.push(
          <a key={m.index} href={href} target="_blank" rel="noreferrer">
            {m[4]}
          </a>,
        );
      else
        out.push(
          <a key={m.index} href={href}>
            {m[4]}
          </a>,
        );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}

/** Text for `key`, with markup() tags turned into elements. */
export function rich(key: Key, vars: Vars = {}): ReactNode {
  return markup(t(key, vars));
}
