import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { TreeNode } from '../api/types';
import { Editor } from './Editor';

export type LineKind = 'cmd' | 'out' | 'err' | 'sys' | 'ok' | 'warn';
interface Line {
  id: number;
  kind: LineKind;
  text: string;
  prompt?: string;
}

export interface TerminalHandle {
  focus(): void;
  print(text: string, kind?: LineKind): void;
  isEditing(): boolean;
}

interface Props {
  sessionId: string;
  cwd: string;
  tree: TreeNode;
  onReport(message: string): Promise<void>;
}

const HOME = '/home/worker';
const MAX_LINES = 1500;

export function tildify(path: string) {
  if (path === HOME) return '~';
  if (path.startsWith(HOME + '/')) return '~' + path.slice(HOME.length);
  return path;
}

function findNode(tree: TreeNode, path: string): TreeNode | null {
  if (path === '/' || path === '') return tree;
  let cur: TreeNode | undefined = tree;
  for (const part of path.split('/').filter(Boolean)) {
    cur = cur?.children?.find((c) => c.name === part);
    if (!cur) return null;
  }
  return cur ?? null;
}

function resolvePath(cwd: string, p: string) {
  let s = p;
  if (s === '~' || s.startsWith('~/')) s = HOME + s.slice(1);
  const abs = s.startsWith('/') ? s : `${cwd}/${s}`;
  const out: string[] = [];
  for (const part of abs.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

let lineId = 0;

export const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ sessionId, cwd, tree, onReport }, ref) {
  const [lines, setLines] = useState<Line[]>(() => [
    { id: ++lineId, kind: 'sys', text: 'Terminal ready. Report with Ctrl+Enter or type done.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ path: string; content: string; isNew: boolean } | null>(null);
  const [localCwd, setLocalCwd] = useState(cwd);
  const history = useRef<string[]>([]);
  const histIdx = useRef<number>(-1);
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const editingRef = useRef(false);
  editingRef.current = editing !== null;

  // The server's cwd wins whenever it changes (e.g. after a reconnect).
  useEffect(() => setLocalCwd(cwd), [cwd]);

  const push = useCallback((add: Omit<Line, 'id'>[]) => {
    setLines((cur) => {
      const next = [...cur, ...add.map((l) => ({ ...l, id: ++lineId }))];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const focus = useCallback(() => {
    if (!editingRef.current) inputRef.current?.focus({ preventScroll: true });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus,
      print: (text, kind = 'sys') => push([{ kind, text }]),
      isEditing: () => editingRef.current,
    }),
    [focus, push],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const prompt = `worker@755:${tildify(localCwd)}$`;

  const openEditor = async (path: string) => {
    let content = '';
    let isNew = false;
    try {
      content = (await client.readFile(sessionId, path)).content;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        push([{ kind: 'err', text: 'edit: no connection' }]);
        return;
      }
      isNew = true;
    }
    setEditing({ path, content, isNew });
  };

  const run = (line: string) => {
    const p = prompt;
    push([{ kind: 'cmd', text: line, prompt: p }]);
    const trimmed = line.trim();
    if (!trimmed) return;
    if (history.current[history.current.length - 1] !== line) history.current.push(line);
    histIdx.current = -1;
    stick.current = true;

    const m = /^(done|report)(?:\s+([\s\S]*))?$/.exec(trimmed);
    if (m) {
      const msg = (m[2] ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
      queue.current = queue.current.then(() => onReport(msg));
      return;
    }

    queue.current = queue.current.then(async () => {
      setBusy(true);
      try {
        const r = await client.exec(sessionId, line);
        setLocalCwd(r.cwd);
        const add: Omit<Line, 'id'>[] = [];
        if (r.stdout) add.push({ kind: 'out', text: r.stdout.replace(/\n$/, '') });
        if (r.stderr) add.push({ kind: 'err', text: r.stderr.replace(/\n$/, '') });
        if (r.action?.type === 'clear') setLines([]);
        else if (add.length) push(add);
        if (r.action?.type === 'edit') await openEditor(r.action.path);
      } catch (e) {
        push([{ kind: 'err', text: e instanceof ApiError && e.status !== 0 ? e.message : 'No connection. Command not run.' }]);
      } finally {
        setBusy(false);
      }
    });
  };

  const complete = () => {
    const before = input.slice(0, inputRef.current?.selectionStart ?? input.length);
    const after = input.slice(before.length);
    const m = /(\S*)$/.exec(before);
    const raw = m ? m[1] : '';
    const quote = /^["']/.test(raw) ? raw[0] : '';
    const word = raw.slice(quote.length);
    const isFirst = before.trim() === raw;
    if (isFirst && !word.includes('/')) return; // no command completion
    const slash = word.lastIndexOf('/');
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
    const prefix = slash >= 0 ? word.slice(slash + 1) : word;
    const dir = findNode(tree, resolvePath(localCwd, dirPart || '.'));
    if (!dir?.children) return;
    const hits = dir.children.filter((c) => c.name.startsWith(prefix) && (prefix.startsWith('.') || !c.name.startsWith('.')));
    if (!hits.length) return;
    let common = hits[0].name;
    for (const h of hits) while (!h.name.startsWith(common)) common = common.slice(0, -1);
    let completed = dirPart + common;
    if (hits.length === 1 && hits[0].type === 'dir') completed += '/';
    else if (hits.length === 1) completed += quote ? quote + ' ' : ' ';
    if (completed === word && hits.length > 1) {
      push([
        { kind: 'cmd', text: input, prompt },
        { kind: 'out', text: hits.map((h) => h.name + (h.type === 'dir' ? '/' : '')).join('  ') },
      ]);
      return;
    }
    const nextBefore = before.slice(0, before.length - word.length) + completed;
    if (!quote && /[\s()'"&|;<>]/.test(completed)) {
      // Names with spaces or brackets need quoting to survive the shell.
      const q = before.slice(0, before.length - word.length) + `"${completed.trimEnd()}"` + (completed.endsWith(' ') ? ' ' : '');
      setInput(q + after);
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(q.length, q.length));
      return;
    }
    setInput(nextBefore + after);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextBefore.length, nextBefore.length));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const line = input;
      setInput('');
      run(line);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      if (histIdx.current === -1) {
        draft.current = input;
        histIdx.current = h.length - 1;
      } else histIdx.current = Math.max(0, histIdx.current - 1);
      setInput(h[histIdx.current]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const h = history.current;
      if (histIdx.current === -1) return;
      if (histIdx.current >= h.length - 1) {
        histIdx.current = -1;
        setInput(draft.current);
      } else {
        histIdx.current++;
        setInput(h[histIdx.current]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      e.preventDefault();
      push([{ kind: 'cmd', text: input + '^C', prompt }]);
      setInput('');
      histIdx.current = -1;
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      setLines([]);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      setInput('');
    }
  };

  // Clicking the scrollback focuses the prompt, unless the player is selecting text.
  const onMouseUp = () => {
    if (window.getSelection()?.toString()) return;
    focus();
  };

  const closeEditor = (msg?: { text: string; kind: LineKind }) => {
    setEditing(null);
    if (msg) push([msg]);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  return (
    <section className="term" aria-label="Terminal">
      <div className="term-scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp} hidden={editing !== null}>
        <div className="term-lines" role="log" aria-live="off">
          {lines.map((l) => (
            <div key={l.id} className={`tl tl-${l.kind}`}>
              {l.kind === 'cmd' && <span className="tl-prompt">{l.prompt} </span>}
              {l.text}
            </div>
          ))}
        </div>
        <label className="term-input-row">
          <span className="tl-prompt">{prompt}</span>
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              histIdx.current = -1;
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
            aria-label="Command"
          />
          {busy && <span className="term-busy" aria-hidden />}
        </label>
      </div>
      {editing && (
        <Editor
          key={editing.path}
          sessionId={sessionId}
          path={editing.path}
          displayPath={tildify(editing.path)}
          initial={editing.content}
          isNew={editing.isNew}
          onSaved={(bytes) => closeEditor({ kind: 'ok', text: `Saved ${tildify(editing.path)} (${bytes} bytes)` })}
          onCancel={() => closeEditor({ kind: 'sys', text: `Closed ${tildify(editing.path)} without saving` })}
        />
      )}
    </section>
  );
});
