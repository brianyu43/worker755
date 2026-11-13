import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { TreeNode } from '../api/types';
import { MOD } from '../game/keys';
import { Editor } from './Editor';
import { useStickToBottom } from './stick';
import { Splitter } from './Splitter';
import { t } from '../i18n';
import { rich } from '../i18n/rich';

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
  /** The editor has the keyboard. */
  isEditing(): boolean;
}

interface Props {
  sessionId: string;
  cwd: string;
  tree: TreeNode;
  onReport(message: string): Promise<void>;
  /** Called with the path of the file opened in the editor, and null when it closes. */
  onEditingChange?(path: string | null): void;
}

/** The on-screen keys under the terminal on a phone, which has no Esc, Tab, Ctrl or arrows. */
const SOFT_KEYS: [string, string][] = [
  ['Escape', 'esc'],
  ['Tab', 'tab'],
  ['Control', 'ctrl'],
  ['ArrowUp', '↑'],
  ['ArrowDown', '↓'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['~', '~'],
  ['/', '/'],
  ['|', '|'],
  ['-', '-'],
];

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

export const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ sessionId, cwd, tree, onReport, onEditingChange }, ref) {
  const [lines, setLines] = useState<Line[]>(() => [
    { id: ++lineId, kind: 'sys', text: t('term.ready', { keys: 'Ctrl+Enter', command: 'done' }) },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ path: string; content: string; isNew: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  // Which pane a phone shows; on a wide screen the editor sits beside the terminal and both show.
  const [pane, setPane] = useState<'term' | 'file'>('term');
  // The on-screen Ctrl key, held for the next key.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [localCwd, setLocalCwd] = useState(cwd);
  const history = useRef<string[]>([]);
  const histIdx = useRef<number>(-1);
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref: scrollRef, stick, onScroll } = useStickToBottom<HTMLDivElement>(24);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const editingPath = editing?.path ?? null;
  useEffect(() => onEditingChange?.(editingPath), [editingPath, onEditingChange]);

  // The server's cwd wins whenever it changes (e.g. after a reconnect).
  useEffect(() => setLocalCwd(cwd), [cwd]);

  const push = useCallback((add: Omit<Line, 'id'>[]) => {
    setLines((cur) => {
      const next = [...cur, ...add.map((l) => ({ ...l, id: ++lineId }))];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  // Only when the prompt is on screen: on a phone showing the editor, the editor keeps the keyboard.
  const focus = useCallback(() => {
    const el = inputRef.current;
    if (el && el.offsetParent !== null) el.focus({ preventScroll: true });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus,
      print: (text, kind = 'sys') => push([{ kind, text }]),
      isEditing: () => editorRef.current !== null && document.activeElement === editorRef.current,
    }),
    [focus, push],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  const prompt = `worker@755:${tildify(localCwd)}$`;

  const openEditor = async (path: string) => {
    let content = '';
    let isNew = false;
    try {
      content = (await client.readFile(sessionId, path)).content;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        push([{ kind: 'err', text: t('term.editOffline') }]);
        return;
      }
      isNew = true;
    }
    setEditing({ path, content, isNew });
    setDirty(false);
    setPane('file');
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
        push([{ kind: 'err', text: e instanceof ApiError && e.status !== 0 ? e.message : t('term.offline') }]);
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

  const caretTo = (pos: number) => requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));

  /** Runs a key on the prompt; true when it was handled. Shared by the keyboard and the on-screen keys. */
  const handleKey = (key: string, ctrl: boolean): boolean => {
    if (ctrl) {
      const k = key.toLowerCase();
      if (k === 'c' && !window.getSelection()?.toString()) {
        push([{ kind: 'cmd', text: input + '^C', prompt }]);
        setInput('');
        histIdx.current = -1;
        return true;
      }
      if (k === 'l') {
        setLines([]);
        return true;
      }
      if (k === 'u') {
        setInput('');
        return true;
      }
      return false;
    }
    if (key === 'Enter') {
      const line = input;
      setInput('');
      run(line);
    } else if (key === 'ArrowUp') {
      const h = history.current;
      if (!h.length) return true;
      if (histIdx.current === -1) {
        draft.current = input;
        histIdx.current = h.length - 1;
      } else histIdx.current = Math.max(0, histIdx.current - 1);
      setInput(h[histIdx.current]);
    } else if (key === 'ArrowDown') {
      const h = history.current;
      if (histIdx.current === -1) return true;
      if (histIdx.current >= h.length - 1) {
        histIdx.current = -1;
        setInput(draft.current);
      } else {
        histIdx.current++;
        setInput(h[histIdx.current]);
      }
    } else if (key === 'Tab') {
      complete();
    } else return false;
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.altKey) return;
    if (ctrlHeld && e.key.length === 1) {
      setCtrlHeld(false);
      if (handleKey(e.key, true)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && e.ctrlKey) return; // Ctrl+Enter reports; the play screen handles it.
    if (handleKey(e.key, e.ctrlKey)) e.preventDefault();
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    // A phone keyboard sends no keydown for letters, so a held Ctrl catches the typed letter here.
    if (ctrlHeld && next.length === input.length + 1) {
      const at = (e.target.selectionStart ?? next.length) - 1;
      setCtrlHeld(false);
      if (handleKey(next[at] ?? '', true)) return;
    }
    setInput(next);
    histIdx.current = -1;
  };

  const softKey = (key: string) => {
    const el = inputRef.current;
    if (key === 'Control') {
      setCtrlHeld(!ctrlHeld);
      return;
    }
    if (key === 'Escape') {
      setCtrlHeld(false);
      setInput('');
      histIdx.current = -1;
      return;
    }
    if (ctrlHeld) {
      setCtrlHeld(false);
      if (handleKey(key, true)) return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const at = el?.selectionStart ?? input.length;
      caretTo(Math.max(0, Math.min(input.length, at + (key === 'ArrowLeft' ? -1 : 1))));
      return;
    }
    if (handleKey(key, false)) return;
    // A character: typed at the caret.
    const a = el?.selectionStart ?? input.length;
    const b = el?.selectionEnd ?? a;
    setInput(input.slice(0, a) + key + input.slice(b));
    histIdx.current = -1;
    caretTo(a + key.length);
  };

  // Clicking the scrollback focuses the prompt, unless the player is selecting text.
  const onMouseUp = () => {
    if (window.getSelection()?.toString()) return;
    focus();
  };

  const closeEditor = (msg?: { text: string; kind: LineKind }) => {
    setEditing(null);
    setDirty(false);
    setPane('term');
    if (msg) push([msg]);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  const showPane = (next: 'term' | 'file') => {
    setPane(next);
    requestAnimationFrame(() => (next === 'file' ? editorRef.current?.focus({ preventScroll: true }) : focus()));
  };

  const fileName = editing ? editing.path.slice(editing.path.lastIndexOf('/') + 1) : '';

  return (
    <section className={`term term-pane-${editing ? pane : 'term'}${editing ? ' term-editing' : ''}`} aria-label={t('term.label')}>
      <div className="term-head">
        <div className="term-tabs">
          <button
            type="button"
            className={`term-tab${!editing || pane === 'term' ? ' term-tab-on' : ''}`}
            aria-pressed={!editing || pane === 'term'}
            onClick={() => showPane('term')}
          >
            <span className="term-tab-mark" aria-hidden />
            {t('term.label')}
          </button>
          {editing && (
            <button
              type="button"
              className={`term-tab term-tab-file${pane === 'file' ? ' term-tab-on' : ''}`}
              aria-pressed={pane === 'file'}
              onClick={() => showPane('file')}
            >
              {fileName}
              {dirty && <span className="term-tab-dirty" aria-label={t('editor.modified')} />}
            </button>
          )}
        </div>
        <span className="term-path">worker@755 · {tildify(localCwd)}</span>
        <span className="term-hint">{rich('term.hint', { command: 'done', keys: `${MOD} ↵` })}</span>
      </div>
      <div className="term-body">
        <div className="term-scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
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
              onChange={onChange}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              aria-label={t('term.command')}
            />
            {busy && <span className="term-busy" aria-hidden />}
          </label>
        </div>
        {editing && <Splitter kind="editor" />}
        {editing && (
          <Editor
            key={editing.path}
            ref={editorRef}
            sessionId={sessionId}
            path={editing.path}
            displayPath={tildify(editing.path)}
            initial={editing.content}
            isNew={editing.isNew}
            onDirtyChange={setDirty}
            onSaved={(bytes) => closeEditor({ kind: 'ok', text: t('term.saved', { path: tildify(editing.path), count: bytes }) })}
            onCancel={() => closeEditor({ kind: 'sys', text: t('term.closed', { path: tildify(editing.path) }) })}
          />
        )}
      </div>
      <div className="term-keys" role="toolbar" aria-label={t('term.keys')}>
        {SOFT_KEYS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`term-key${key === 'Control' && ctrlHeld ? ' term-key-held' : ''}`}
            aria-pressed={key === 'Control' ? ctrlHeld : undefined}
            // Keep the phone keyboard up: the prompt never loses focus to these buttons.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => softKey(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
});
