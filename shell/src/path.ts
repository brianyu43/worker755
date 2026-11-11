// POSIX path helpers. Pure string manipulation, no filesystem access.

/** Normalise an absolute path: collapse `//`, resolve `.` and `..`, drop the trailing slash. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

/** Resolve `path` against the absolute directory `cwd`. No tilde expansion. */
export function resolvePath(cwd: string, path: string): string {
  if (path.startsWith('/')) return normalize(path);
  return normalize(cwd + '/' + path);
}

export function dirname(path: string): string {
  const p = normalize(path);
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function basename(path: string): string {
  const p = normalize(path);
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Split an absolute path into its components ('/' gives []). */
export function segments(path: string): string[] {
  return normalize(path).split('/').filter(Boolean);
}

/** Join path pieces the way a user would type them (no normalisation of `.`/`..`). */
export function join(a: string, b: string): string {
  if (a === '') return b;
  return a.endsWith('/') ? a + b : a + '/' + b;
}

/** True when `inner` is `outer` itself or lies below it. Both absolute and normalised. */
export function isWithin(outer: string, inner: string): boolean {
  if (outer === '/') return true;
  return inner === outer || inner.startsWith(outer + '/');
}
