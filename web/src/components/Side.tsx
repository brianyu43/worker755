import { useEffect, useRef, useState } from 'react';
import type { Stats, TreeNode } from '../api/types';
import { t, type Key } from '../i18n';

export function modeString(type: 'file' | 'dir', mode: number): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
}

interface Row {
  node: TreeNode;
  depth: number;
  /** Box-drawing guides in front of the name: "│  ├─ ". */
  branch: string;
}

function flatten(node: TreeNode, depth: number, out: Row[], guides = '', last = true) {
  out.push({ node, depth, branch: depth === 0 ? '' : guides + (last ? '└─ ' : '├─ ') });
  const kids = node.children ?? [];
  const next = depth === 0 ? '' : guides + (last ? '   ' : '│  ');
  kids.forEach((c, i) => flatten(c, depth + 1, out, next, i === kids.length - 1));
  return out;
}

function findNode(tree: TreeNode, path: string): TreeNode | null {
  if (tree.path === path) return tree;
  for (const c of tree.children ?? []) {
    const f = findNode(c, path);
    if (f) return f;
  }
  return null;
}

const sig = (n: TreeNode) => `${n.type}:${n.mode}:${n.size}`;

const HOME = '/home/worker';

/** The top two levels of a path (/home/worker, /srv/billosaurus), or null above them. */
function areaOf(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  return parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : null;
}

interface FileTreeProps {
  tree: TreeNode;
  cwd: string;
  /** The file open in the editor, if any. */
  editing?: string | null;
  /** Files lost to the director this shift. */
  lost?: number;
}

export function FileTree({ tree, cwd, editing = null, lost = 0 }: FileTreeProps) {
  // Show the area the player is working in (their home, another user's home, an app), or everything above that.
  const area = areaOf(cwd);
  const root = (area && findNode(tree, area)) || tree;
  const rows = flatten(root, 0, []);
  const rootName = root.path === HOME ? '~' : root.path;

  const prev = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const now = new Map(flatten(tree, 0, []).map((r) => [r.node.path, sig(r.node)]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const diff = new Set<string>();
    for (const [p, s] of now) if (before.get(p) !== s && !(now.get(p)?.startsWith('dir') && before.has(p))) diff.add(p);
    if (!diff.size) return;
    setChanged(diff);
    const timer = setTimeout(() => setChanged(new Set()), 1600);
    return () => clearTimeout(timer);
  }, [tree]);

  return (
    <section className="panel files" aria-label={t('files.title')}>
      <header className="panel-head">
        <h2>{t('files.title')}</h2>
        <small className="panel-sub">
          {rootName} · {t('files.items', { count: root.children?.length ?? 0 })}
        </small>
      </header>
      <ul className="tree">
        {rows.map(({ node, depth, branch }) => {
          const open = node.path === editing;
          return (
            <li
              key={node.path}
              className={`tree-row${node.path === cwd ? ' tree-cwd' : ''}${open ? ' tree-open' : ''}${node.type === 'dir' ? ' tree-dir' : ''}${changed.has(node.path) ? ' tree-changed' : ''}`}
              title={`${modeString(node.type, node.mode)}  ${node.path}`}
            >
              <span className="tree-branch" aria-hidden>
                {branch}
              </span>
              <span className="tree-name">
                {depth === 0 ? rootName : node.name}
                {node.type === 'dir' && depth > 0 ? '/' : ''}
              </span>
              <span className="tree-size">{open ? t('files.editing') : node.type === 'file' ? node.size : ''}</span>
            </li>
          );
        })}
      </ul>
      {lost > 0 && (
        <div className="files-lost">
          <span className="files-lost-dot" aria-hidden />
          {t('files.lost', { count: lost })}
        </div>
      )}
    </section>
  );
}

export function statRows(s: Stats): [string, string, boolean?][] {
  return [
    [t('record.signedOff'), String(s.missionsCompleted)],
    [t('record.failed'), String(s.missionsFailed), s.missionsFailed > 0],
    [t('record.instructions'), String(s.instructions)],
    [t('record.corrections'), String(s.corrections), s.corrections > 0],
    [t('record.idle'), String(s.timeoutsIdle), s.timeoutsIdle > 0],
    [t('record.late'), String(s.timeoutsPartial), s.timeoutsPartial > 0],
    [t('record.reports'), String(s.reports)],
    [t('record.commands'), String(s.commands)],
    [t('record.commandErrors'), String(s.commandErrors), s.commandErrors > 0],
    [t('record.avgResponse'), s.avgResponseMs ? t('record.seconds', { value: (s.avgResponseMs / 1000).toFixed(1) }) : '–'],
    [t('record.fooled'), String(s.managerFooled), s.managerFooled > 0],
    [t('record.incidents'), String(s.incidents), s.incidents > 0],
    [t('record.damaged'), String(s.damaged ?? 0), (s.damaged ?? 0) > 0],
  ];
}

const GROUPS: [Key, number, number][] = [
  ['record.group.assignments', 0, 6],
  ['record.group.activity', 6, 10],
  ['record.group.conduct', 10, 13],
];
/** Row index of "times the manager was wrong": good news for the player, so marked, not flagged. */
const FOOLED = 10;

export function standingOf(s: Stats): { key: Key; bad: boolean } {
  if ((s.damaged ?? 0) > 0) return { key: 'review.verdict.investigation', bad: true };
  if (s.incidents > 0 || s.missionsFailed > 0 || s.timeoutsIdle > 0) return { key: 'record.standing.notice', bad: true };
  return { key: 'record.standing.good', bad: false };
}

/** `onEnd` offers ending the shift early, under the standing; left out once the shift is over. */
export function StatsPanel({ stats, onEnd }: { stats: Stats; onEnd?: () => void }) {
  const rows = statRows(stats);
  const standing = standingOf(stats);
  return (
    <section className="panel stats" aria-label={t('record.title')}>
      <header className="panel-head">
        <h2>{t('record.title')}</h2>
      </header>
      <div className="stats-body">
        {GROUPS.map(([title, from, to]) => (
          <div key={title} className="ledger-group">
            <h3 className="ledger-title">{t(title)}</h3>
            <dl className="ledger">
              {rows.slice(from, to).map(([k, v, bad], i) => {
                const good = from + i === FOOLED && bad;
                return (
                  <div key={k} className={`ledger-row${good ? ' ledger-good' : bad ? ' ledger-bad' : ''}`}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
        <div className="standing">
          <span className="standing-label">{t('record.standing')}</span>
          <span className={`standing-stamp${standing.bad ? ' standing-bad' : ''}`}>{t(standing.key)}</span>
          {onEnd && (
            <button type="button" className="btn end-now" onClick={onEnd}>
              {t('end.button')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
