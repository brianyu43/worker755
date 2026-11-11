import { useEffect, useRef, useState } from 'react';
import { ApiError, client } from '../api/client';
import { MOD } from '../game/keys';

interface Props {
  sessionId: string;
  path: string;
  displayPath: string;
  initial: string;
  isNew: boolean;
  onSaved(bytes: number): void;
  onCancel(): void;
}

export function Editor({ sessionId, path, displayPath, initial, isNew, onSaved, onCancel }: Props) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== initial;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.writeFile(sessionId, path, text);
      onSaved(new TextEncoder().encode(text).length);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Not saved. No connection.');
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
      requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
    }
  };

  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  const bytes = new TextEncoder().encode(text).length;

  return (
    <div className="editor" role="dialog" aria-label={`Editing ${displayPath}`}>
      <div className="editor-head">
        <span className="editor-path">{displayPath}</span>
        <span className="editor-state">{isNew && !dirty ? 'New file' : dirty ? 'Modified' : 'Unchanged'}</span>
      </div>
      <textarea
        ref={ref}
        className="editor-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="File contents"
      />
      <div className="editor-foot">
        <span className="editor-meta">
          {lines} {lines === 1 ? 'line' : 'lines'}, {bytes} bytes
        </span>
        {error && <span className="editor-error">{error}</span>}
        <span className="editor-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel <kbd>Esc</kbd>
          </button>
          <button type="button" className="btn btn-ink" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : 'Save'} <kbd>{MOD} S</kbd>
          </button>
        </span>
      </div>
    </div>
  );
}
