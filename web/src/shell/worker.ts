// The player's shell, in a Web Worker so a runaway command never freezes the page: the page can always
// terminate this worker and start a new one from the last good state (see local.ts).
import { applyChanges, collectChanges, createShell, loadSnapshot } from '../../../shell/src/index.ts';
import type { VirtualShell, Web, WebPage, WebResult } from '../../../shell/src/index.ts';
import type { Request, Response, WebAccess } from './protocol';

const port = self as unknown as { postMessage(m: Response): void; onmessage: ((e: MessageEvent<Request>) => void) | null };

let sh: VirtualShell | null = null;

/**
 * curl and websearch reach the game's simulated web on the server. The shell is synchronous, and a
 * worker may make synchronous requests, so the lookup simply waits for the answer.
 */
function webFor(access: WebAccess): Web {
  const get = <T,>(query: string): T | null => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${access.base}/web?${query}`, false);
      xhr.setRequestHeader('X-Session-Token', access.token);
      xhr.timeout = 5000;
      xhr.send();
      return xhr.status === 200 ? (JSON.parse(xhr.responseText) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    search: (q) => get<{ results: WebResult[] }>(`search=${encodeURIComponent(q)}`)?.results ?? [],
    fetch: (url) => get<{ page: WebPage | null }>(`url=${encodeURIComponent(url)}`)?.page ?? null,
  };
}

function shell(): VirtualShell {
  if (!sh) throw new Error('the shell has not started');
  return sh;
}

function handle(msg: Request): Response {
  switch (msg.type) {
    case 'init': {
      const next = createShell({ system: false, web: msg.web ? webFor(msg.web) : undefined });
      loadSnapshot(next.fs, msg.entries);
      next.installSystem();
      if (msg.state) next.restore(msg.state);
      if (next.fs.stat(msg.cwd)?.type === 'dir') next.cwd = msg.cwd;
      next.fs.record();
      sh = next;
      return { id: msg.id, type: 'ready' };
    }
    case 'exec': {
      const s = shell();
      const result = s.exec(msg.line);
      return { id: msg.id, type: 'exec', result, cwd: s.cwd, changes: collectChanges(s.fs), state: s.snapshot() };
    }
    case 'apply': {
      const s = shell();
      s.fs.unrecorded(() => applyChanges(s.fs, msg.changes));
      return { id: msg.id, type: 'ready' };
    }
    case 'reload': {
      const s = shell();
      s.fs.unrecorded(() => loadSnapshot(s.fs, msg.entries));
      s.fs.takeJournal();
      s.cwd = s.fs.stat(msg.cwd)?.type === 'dir' ? msg.cwd : s.home;
      return { id: msg.id, type: 'ready' };
    }
    case 'read': {
      const s = shell();
      const path = s.resolve(msg.path);
      return { id: msg.id, type: 'read', path, content: s.fs.readFile(path) };
    }
    case 'write': {
      const s = shell();
      const path = s.resolve(msg.path);
      s.fs.writeFile(path, msg.content);
      return { id: msg.id, type: 'write', path, changes: collectChanges(s.fs) };
    }
    case 'names':
      return { id: msg.id, type: 'names', names: shell().commandNames() };
  }
}

port.onmessage = (e) => {
  let reply: Response;
  try {
    reply = handle(e.data);
  } catch (err) {
    reply = { id: e.data.id, type: 'error', message: err instanceof Error ? err.message : 'failed' };
  }
  port.postMessage(reply);
};
