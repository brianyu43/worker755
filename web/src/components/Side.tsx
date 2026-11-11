import { useEffect, useRef, useState } from 'react';
import type { Stats, TreeNode } from '../api/types';

export function modeString(type: 'file' | 'dir', mode: number): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
}

function flatten(node: TreeNode, depth: number, out: { node: TreeNode; depth: number }[]) {
  out.push({ node, depth });
  for (const c of node.children ?? []) flatten(c, depth + 1, out);
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

export function FileTree({ tree, cwd }: { tree: TreeNode; cwd: string }) {
  // Show the area the player is working in (their home, another user's home, an app), or everything above that.
  const area = areaOf(cwd);
  const root = (area && findNode(tree, area)) || tree;
  const rows = flatten(root, 0, []);

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
    const t = setTimeout(() => setChanged(new Set()), 1600);
    return () => clearTimeout(t);
  }, [tree]);

  return (
    <section className="panel files" aria-label="Files">
      <header className="panel-head">
        <h2>Files</h2>
      </header>
      <ul className="tree">
        {rows.map(({ node, depth }) => (
          <li
            key={node.path}
            className={`tree-row${node.path === cwd ? ' tree-cwd' : ''}${changed.has(node.path) ? ' tree-changed' : ''}`}
          >
            <span className="tree-mode">{modeString(node.type, node.mode)}</span>
            <span className="tree-name" style={{ paddingLeft: `${depth * 1.1}em` }}>
              {depth === 0 ? (root.path === HOME ? '~' : root.path) : node.name}
              {node.type === 'dir' && depth > 0 ? '/' : ''}
            </span>
            <span className="tree-size">{node.type === 'file' ? node.size : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function statRows(s: Stats): [string, string, boolean?][] {
  return [
    ['Assignments signed off', String(s.missionsCompleted)],
    ['Assignments failed', String(s.missionsFailed), s.missionsFailed > 0],
    ['Instructions received', String(s.instructions)],
    ['Corrections', String(s.corrections), s.corrections > 0],
    ['Did nothing', String(s.timeoutsIdle), s.timeoutsIdle > 0],
    ['Ran out of time', String(s.timeoutsPartial), s.timeoutsPartial > 0],
    ['Reports filed', String(s.reports)],
    ['Commands run', String(s.commands)],
    ['Commands failed', String(s.commandErrors), s.commandErrors > 0],
    ['Average response', s.avgResponseMs ? `${(s.avgResponseMs / 1000).toFixed(1)} s` : '–'],
    ['Times the manager was wrong', String(s.managerFooled), s.managerFooled > 0],
    ['Incident reports against you', String(s.incidents), s.incidents > 0],
    ['Collateral damage', String(s.damaged ?? 0), (s.damaged ?? 0) > 0],
  ];
}

export function StatsPanel({ stats }: { stats: Stats }) {
  return (
    <section className="panel stats" aria-label="Your record">
      <header className="panel-head">
        <h2>Your record</h2>
      </header>
      <dl className="ledger">
        {statRows(stats).map(([k, v, bad]) => (
          <div key={k} className={`ledger-row${bad ? ' ledger-bad' : ''}`}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
