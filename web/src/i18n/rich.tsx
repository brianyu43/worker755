import { Fragment, type ReactNode } from 'react';
import { t, type Key, type Vars } from './index.ts';

// The only tags a translation may use. Anything else is shown as text.
const TAGS = { code: 'code', strong: 'strong', q: 'q' } as const;

/** Text for `key` with its <code>, <strong> and <q> tags turned into elements. Tags do not nest. */
export function rich(key: Key, vars: Vars = {}): ReactNode {
  const text = t(key, vars);
  const out: ReactNode[] = [];
  const re = /<(code|strong|q)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const Tag = TAGS[m[1] as keyof typeof TAGS];
    out.push(<Tag key={m.index}>{m[2]}</Tag>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
