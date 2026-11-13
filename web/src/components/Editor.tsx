import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import { MOD } from '../game/keys';
import { t } from '../i18n';

interface Props {
  sessionId: string;
  path: string;
  displayPath: string;
  initial: string;
  isNew: boolean;
  onDirtyChange?(dirty: boolean): void;
  onSaved(bytes: number): void;
  onCancel(): void;
}

/** Line and column of a caret offset, both from 1. */
function position(text: string, at: number) {
  const before = text.slice(0, at);
  const nl = before.lastIndexOf('\n');
  return { line: before.split('\n').length, col: at - nl };
}

export const Editor = forwardRef<HTMLTextAreaElement | null, Props>(function Editor(
  { sessionId, path, displayPath, initial, isNew, onDirtyChange, onSaved, onCancel },
  forwarded,
) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(initial.length);
  const ref = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const dirty = text !== initial;
  useImperativeHandle(forwarded, () => ref.current!, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.writeFile(sessionId, path, text);
      onSaved(new TextEncoder().encode(text).length);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : t('editor.offline'));
      setSaving(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = text.slice(0, a) + '  ' + text.slice(b);
      setText(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(a + 2, a + 2);
        setCaret(a + 2);
      });
    }
  };

  const track = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart);

  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  const rows = Math.max(1, text.split('\n').length);
  const bytes = new TextEncoder().encode(text).length;
  const pos = position(text, Math.min(caret, text.length));

  return (
    <div className="editor" role="region" aria-label={t('editor.label', { path: displayPath })}>
      <div className="editor-head">
        <span className="editor-path">{displayPath}</span>
        <span className={`editor-state${dirty ? ' editor-dirty' : ''}`}>
          {isNew && !dirty ? t('editor.new') : dirty ? t('editor.modified') : t('editor.unchanged')}
        </span>
        <button type="button" className="editor-close" onClick={onCancel}>
          {t('editor.cancel')} <kbd>Esc</kbd>
        </button>
      </div>
      <div className="editor-body">
        <div className="editor-gutter" ref={gutter} aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className={i + 1 === pos.line ? 'editor-gutter-cur' : ''}>
              {i + 1}
            </span>
          ))}
        </div>
        <textarea
          ref={ref}
          className="editor-text"
          value={text}
          wrap="off"
          onChange={(e) => {
            setText(e.target.value);
            track(e);
          }}
          onKeyDown={onKeyDown}
          onSelect={track}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={t('editor.contents')}
        />
      </div>
      <div className="editor-foot">
        <span className="editor-pos">{t('editor.position', { line: pos.line, col: pos.col })}</span>
        <span className="editor-meta">
          {t('editor.size', { lines: t('editor.lines', { count: lines }), bytes: t('editor.bytes', { count: bytes }) })}
        </span>
        {error && <span className="editor-error">{error}</span>}
        <button type="button" className="editor-save" onClick={() => void save()} disabled={saving}>
          {saving ? t('editor.saving') : t('editor.save')} <kbd>{MOD} S</kbd>
        </button>
      </div>
    </div>
  );
});
