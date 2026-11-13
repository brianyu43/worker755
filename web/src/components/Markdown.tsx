import { Fragment, type ReactNode } from 'react';

// The Markdown models write in chat: headings, lists, quotes, code, tables, rules, and inline bold,
// italic, strikethrough, code and links. Everything becomes React elements, never raw HTML, so a
// model cannot put markup on the page. Underscores inside words stay as they are (file_names.txt).

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', lines: para.splice(0) });
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ kind: 'h', level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push({ kind: 'hr' });
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ kind: 'table', head, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      out.push({ kind: 'quote', lines: body });
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      flush();
      const ordered = !bullet;
      const items: string[] = [];
      const start = number ? Number(number[1]) : 1;
      while (i < lines.length) {
        const l = lines[i];
        const m = ordered ? NUMBER.exec(l) : BULLET.exec(l);
        if (m) {
          items.push(ordered ? m[2] : m[1]);
          i++;
        } else if (l.trim() && /^\s{2,}/.test(l) && items.length) {
          // An indented line carries on the item above (or is a nested item, shown flat).
          const nested = BULLET.exec(l) ?? NUMBER.exec(l);
          items[items.length - 1] += `\n${nested ? `• ${nested[nested.length - 1]}` : l.trim()}`;
          i++;
        } else break;
      }
      out.push({ kind: 'list', ordered, start, items });
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

// Inline: `code`, [text](https://…), **bold** / __bold__, ~~strike~~, *italic* / _italic_.
const INLINE =
  /(`+)([\s\S]+?)\1|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*|(?<![\w])__(?!\s)([\s\S]+?)(?<!\s)__(?![\w])|~~(?!\s)([\s\S]+?)(?<!\s)~~|(?<![*\w])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?![*\w])|(?<![\w])_(?![\s_])([^_\n]+?)(?<!\s)_(?![\w])/g;

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  const matches = [...text.matchAll(INLINE)];
  for (const m of matches) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}.${at}`;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2].trim()}</code>);
    else if (m[3] !== undefined)
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noreferrer noopener">
          {inline(m[3], k)}
        </a>,
      );
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<strong key={k}>{inline(m[5] ?? m[6], k)}</strong>);
    else if (m[7] !== undefined) out.push(<s key={k}>{inline(m[7], k)}</s>);
    else out.push(<em key={k}>{inline(m[8] ?? m[9], k)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines of one block, with the line breaks a chat message has. */
function lines(list: string[], key: string): ReactNode {
  return list.map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(l, `${key}.${i}`)}
    </Fragment>
  ));
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      {blocks(text).map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case 'p':
            return <p key={k}>{lines(b.lines, k)}</p>;
          case 'h':
            return (
              <p key={k} className={`md-h md-h${Math.min(b.level, 3)}`}>
                {inline(b.text, k)}
              </p>
            );
          case 'code':
            return (
              <pre key={k} className="md-code">
                <code>{b.text}</code>
              </pre>
            );
          case 'quote':
            return <blockquote key={k}>{lines(b.lines, k)}</blockquote>;
          case 'hr':
            return <hr key={k} />;
          case 'list': {
            const items = b.items.map((item, j) => <li key={j}>{lines(item.split('\n'), `${k}.${j}`)}</li>);
            return b.ordered ? (
              <ol key={k} start={b.start}>
                {items}
              </ol>
            ) : (
              <ul key={k}>{items}</ul>
            );
          }
          case 'table':
            return (
              <div key={k} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c, `${k}.h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, j) => (
                          <td key={j}>{inline(c, `${k}.${r}.${j}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
