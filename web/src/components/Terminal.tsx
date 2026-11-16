import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import type { DestroyCause, TreeNode } from '../api/types';
import { Monitor } from './Monitor';
import type { Screen } from './Monitor';
import { Ansi } from './Ansi';
import { MOD, touchOnly } from '../game/keys';
import { Editor } from './Editor';
import { useStickToBottom } from './stick';
import { Splitter } from './Splitter';
import { t } from '../i18n';
import { rich } from '../i18n/rich';
import { isIncomplete } from '../../../shell/src/parser.ts';

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
  /** Opens a file in the editor, as `nano path` would. */
  open(path: string): void;
}

interface Props {
  sessionId: string;
  cwd: string;
  tree: TreeNode;
  onReport(message: string): Promise<void>;
  /** Called with the path of the file opened in the editor, and null when it closes. */
  onEditingChange?(path: string | null): void;
  /** The machine is gone (destroyed earlier, e.g. before a reload): the screen stays dead. */
  destroyed?: DestroyCause | null;
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

/** What a fresh login prints after the machine comes back. */
function loginLines(last: Date): string[] {
  const d = last;
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${day} ${mon} ${String(d.getUTCDate()).padStart(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
  return [
    'Ubuntu 24.04.1 LTS 755 tty1',
    '',
    '755 login: worker (automatic login)',
    `Last login: ${when} from 10.0.7.1 on pts/0`,
    'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64)',
    '',
  ];
}

export const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ sessionId, cwd, tree, onReport, onEditingChange, destroyed }, ref) {
  const [lines, setLines] = useState<Line[]>(() => [
    { id: ++lineId, kind: 'sys', text: t('term.ready', { keys: 'Ctrl+Enter', command: 'done' }) },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** A command has the screen: an animation, a restart, or the end of the machine. */
  const [screen, setScreen] = useState<Screen | null>(null);
  /** When this terminal logged in, for the "Last login" line after a restart. */
  const loggedIn = useRef(new Date());
  const dead = !!destroyed || screen?.kind === 'destroy';
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
  /** Lines typed so far of a command that is not finished yet (an open quote, `if` without `fi`, …). */
  const [more, setMore] = useState<string | null>(null);
  /** Ctrl+R: the text searched for in history, and where the match is. */
  const [search, setSearch] = useState<{ query: string; at: number } | null>(null);
  /** Every command name the shell knows, for Tab completion of the first word. */
  const names = useRef<string[]>([]);
  const loadNames = useCallback(() => {
    client.commandNames(sessionId).then((n) => (names.current = n), () => {});
  }, [sessionId]);
  useEffect(loadNames, [loadNames]);
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

  /** The newest openEditor, for the handle (it closes over this render's state). */
  const openRef = useRef<(path: string) => Promise<void>>(async () => {});

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
      open: (path) => void openRef.current(path),
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
  openRef.current = openEditor;

  /** The screen is the terminal's again: after an animation, or a fresh login after a restart. */
  const screenDone = () => {
    const was = screen;
    setScreen(null);
    if (was?.kind === 'power') {
      setLines(loginLines(loggedIn.current).map((text) => ({ id: ++lineId, kind: 'out' as const, text })));
      loggedIn.current = new Date();
      loadNames();
    }
    stick.current = true;
    requestAnimationFrame(() => focus());
  };

  const run = (typed: string) => {
    if (dead || screen) return;
    push([{ kind: 'cmd', text: typed, prompt: more === null ? prompt : '>' }]);
    const line = more === null ? typed : `${more}\n${typed}`;
    // An unfinished command waits for its next line, as bash does with its > prompt.
    if (line.trim() && isIncomplete(line)) {
      setMore(line);
      return;
    }
    setMore(null);
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
        if (r.killed) add.push({ kind: 'warn', text: t('term.killed') });
        if (r.unsynced) add.push({ kind: 'warn', text: t('term.unsynced') });
        loadNames();
        const action = r.action;
        if (action?.type === 'clear') setLines([]);
        else if (add.length) push(add);
        if (action?.type === 'edit') await openEditor(action.path);
        else if (action?.type === 'animate') setScreen({ kind: 'animate', frames: action.frames, frameMs: action.frameMs, anyKey: action.anyKey, loop: action.loop });
        else if (action?.type === 'power') setScreen({ kind: 'power', mode: action.mode });
        else if (action?.type === 'destroy') setScreen({ kind: 'destroy', cause: action.cause });
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
    if (isFirst && !word.includes('/') && !quote) {
      completeCommand(word, before, after);
      return;
    }
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

  /** Tab on the first word: command names, as bash completes them. */
  const completeCommand = (word: string, before: string, after: string) => {
    const hits = names.current.filter((n) => n.startsWith(word));
    if (!hits.length) return;
    let common = hits[0];
    for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
    if (common === word && hits.length > 1) {
      push([
        { kind: 'cmd', text: input, prompt },
        { kind: 'out', text: hits.join('  ') },
      ]);
      return;
    }
    const nextBefore = before.slice(0, before.length - word.length) + common + (hits.length === 1 ? ' ' : '');
    setInput(nextBefore + after);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(nextBefore.length, nextBefore.length));
  };

  /** The newest history entry at or before `at` that contains `query`; -1 when none. */
  const searchHistory = (query: string, at: number): number => {
    for (let i = Math.min(at, history.current.length - 1); i >= 0; i--) if (history.current[i].includes(query)) return i;
    return -1;
  };
  const searchHit = search ? searchHistory(search.query, search.at) : -1;

  /** Leaves Ctrl+R search, putting the match (or what was there before) on the prompt. */
  const endSearch = (keep: boolean) => {
    const text = keep && searchHit >= 0 ? history.current[searchHit] : draft.current;
    setSearch(null);
    setInput(text);
    caretTo(text.length);
  };

  const caretTo = (pos: number) => requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));

  /** Runs a key on the prompt; true when it was handled. Shared by the keyboard and the on-screen keys. */
  const handleKey = (key: string, ctrl: boolean): boolean => {
    if (search) {
      const k = key.toLowerCase();
      if (ctrl && k === 'r') {
        // Older matches, one per press.
        if (searchHit > 0) setSearch({ query: search.query, at: searchHit - 1 });
        return true;
      }
      if ((ctrl && (k === 'g' || k === 'c')) || key === 'Escape') {
        endSearch(false);
        return true;
      }
      if (key === 'Enter') {
        const text = searchHit >= 0 ? history.current[searchHit] : '';
        setSearch(null);
        setInput('');
        run(text);
        return true;
      }
      if (key === 'Tab' || key.startsWith('Arrow')) {
        endSearch(true);
        return true;
      }
      return false;
    }
    if (ctrl) {
      const k = key.toLowerCase();
      if (k === 'c' && !window.getSelection()?.toString()) {
        push([{ kind: 'cmd', text: input + '^C', prompt: more === null ? prompt : '>' }]);
        setInput('');
        setMore(null);
        histIdx.current = -1;
        return true;
      }
      if (k === 'r') {
        draft.current = input;
        setSearch({ query: '', at: history.current.length - 1 });
        setInput('');
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

  /**
   * Readline-style caret keys: line start/end (Home/End, Ctrl+A/E, Cmd+←/→), word jumps (Alt or
   * Ctrl+←/→, Alt+B/F) and kills (Ctrl+W/K/U). True when the key was one of them.
   */
  const editKey = (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (search || e.shiftKey) return false; // Shift extends the selection; leave that to the browser.
    const el = e.currentTarget;
    const at = el.selectionStart ?? input.length;
    const word = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
    const wordLeft = () => {
      let i = at;
      while (i > 0 && !word(input[i - 1])) i--;
      while (i > 0 && word(input[i - 1])) i--;
      return i;
    };
    const wordRight = () => {
      let i = at;
      while (i < input.length && !word(input[i])) i++;
      while (i < input.length && word(input[i])) i++;
      return i;
    };
    const edit = (text: string, caret: number) => {
      setInput(text);
      histIdx.current = -1;
      caretTo(caret);
    };
    const { key, code, ctrlKey: ctrl, altKey: alt, metaKey: meta } = e;
    const plain = !ctrl && !alt && !meta;
    if ((plain && key === 'Home') || (ctrl && code === 'KeyA') || (meta && key === 'ArrowLeft')) el.setSelectionRange(0, 0);
    else if ((plain && key === 'End') || (ctrl && code === 'KeyE') || (meta && key === 'ArrowRight'))
      el.setSelectionRange(input.length, input.length);
    else if (((alt || ctrl) && key === 'ArrowLeft') || (alt && code === 'KeyB')) el.setSelectionRange(wordLeft(), wordLeft());
    else if (((alt || ctrl) && key === 'ArrowRight') || (alt && code === 'KeyF')) el.setSelectionRange(wordRight(), wordRight());
    else if (ctrl && code === 'KeyW') edit(input.slice(0, wordLeft()) + input.slice(at), wordLeft());
    else if (ctrl && code === 'KeyK') edit(input.slice(0, at), at);
    else if (ctrl && code === 'KeyU') edit(input.slice(at), 0);
    else return false;
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (editKey(e)) {
      e.preventDefault();
      return;
    }
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
    if (search) {
      // While searching, the prompt holds the text searched for; each change searches from the newest.
      setSearch({ query: next, at: history.current.length - 1 });
      setInput(next);
      return;
    }
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
      if (search) {
        endSearch(false);
        return;
      }
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
                {l.kind === 'out' ? <Ansi text={l.text} /> : l.text}
              </div>
            ))}
          </div>
          {!screen && !dead && (
            <label className="term-input-row">
              <span className="tl-prompt">{search ? '(reverse-i-search)' : more === null ? prompt : '>'}</span>
              <input
                ref={inputRef}
                className={`term-input${search ? ' term-input-searching' : ''}`}
                style={search ? { width: `${input.length + 1}ch` } : undefined}
                value={input}
                onChange={onChange}
                onKeyDown={onKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                autoFocus={!touchOnly()}
                aria-label={t('term.command')}
              />
              {search && <span className="term-search-hit">{searchHit >= 0 ? history.current[searchHit] : ''}</span>}
              {busy && <span className="term-busy" aria-hidden />}
            </label>
          )}
        </div>
        {(screen || destroyed) && (
          <Monitor key={screen ? 'live' : 'gone'} screen={screen ?? { kind: 'destroy', cause: destroyed!, instant: true }} onDone={screenDone} />
        )}
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
