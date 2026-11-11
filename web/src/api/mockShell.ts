// A tiny in-browser stand-in for shell/. Only what the canned game needs; not the real interpreter.
import type { ExecResult, TreeNode } from './types';

interface Node {
  type: 'file' | 'dir';
  mode: number;
  content: string;
  mtime: number;
}

const HOME = '/home/worker';

export class MockShell {
  cwd = HOME;
  private nodes = new Map<string, Node>();

  constructor() {
    for (const p of ['/', '/home', HOME]) this.nodes.set(p, { type: 'dir', mode: 0o755, content: '', mtime: Date.now() });
  }

  resolve(path: string): string {
    let p = path;
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    const abs = p.startsWith('/') ? p : `${this.cwd}/${p}`;
    const out: string[] = [];
    for (const part of abs.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return '/' + out.join('/');
  }

  private parent(p: string) {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }

  private base(p: string) {
    return p.slice(p.lastIndexOf('/') + 1);
  }

  get(path: string) {
    return this.nodes.get(path);
  }

  readFile(path: string): string | null {
    const n = this.nodes.get(path);
    return n && n.type === 'file' ? n.content : null;
  }

  writeFile(path: string, content: string, mode = 0o644) {
    const existing = this.nodes.get(path);
    this.nodes.set(path, { type: 'file', mode: existing?.mode ?? mode, content, mtime: Date.now() });
  }

  mkdirp(path: string) {
    let cur = '';
    for (const part of path.split('/').filter(Boolean)) {
      cur += '/' + part;
      if (!this.nodes.has(cur)) this.nodes.set(cur, { type: 'dir', mode: 0o755, content: '', mtime: Date.now() });
    }
  }

  children(path: string): string[] {
    const prefix = path === '/' ? '/' : path + '/';
    return [...this.nodes.keys()]
      .filter((k) => k !== path && k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .sort();
  }

  tree(path = '/'): TreeNode {
    const n = this.nodes.get(path)!;
    const node: TreeNode = {
      name: path === '/' ? '' : this.base(path),
      path,
      type: n.type,
      mode: n.mode,
      size: n.type === 'file' ? new TextEncoder().encode(n.content).length : 0,
    };
    if (n.type === 'dir') node.children = this.children(path).map((c) => this.tree(c));
    return node;
  }

  exec(line: string): ExecResult {
    let tokens: string[][];
    try {
      tokens = splitCommands(line);
    } catch (e) {
      return { stdout: '', stderr: `bash: ${(e as Error).message}\n`, exitCode: 2 };
    }
    let stdout = '';
    let stderr = '';
    let code = 0;
    let action: ExecResult['action'];
    for (const { argv, op } of tokens.map((t) => ({ argv: t, op: (t as string[] & { op?: string }).op }))) {
      if (op === '&&' && code !== 0) continue;
      if (op === '||' && code === 0) continue;
      const r = this.run(argv);
      stdout += r.stdout;
      stderr += r.stderr;
      code = r.exitCode;
      if (r.action) action = r.action;
    }
    return { stdout, stderr, exitCode: code, action };
  }

  private run(raw: string[]): ExecResult {
    let argv = raw;
    let redirect: { path: string; append: boolean } | null = null;
    const ri = argv.findIndex((a) => a === '>' || a === '>>');
    if (ri >= 0) {
      if (!argv[ri + 1]) return err('bash: syntax error near unexpected token `newline\'', 2);
      redirect = { path: this.resolve(argv[ri + 1]), append: argv[ri] === '>>' };
      argv = [...argv.slice(0, ri), ...argv.slice(ri + 2)];
    }
    const [cmd, ...args] = argv;
    if (!cmd) return ok('');
    const flags = new Set(args.filter((a) => a.startsWith('-') && a.length > 1).flatMap((a) => a.slice(1).split('')));
    const ops = args.filter((a) => !(a.startsWith('-') && a.length > 1));
    let r: ExecResult;
    switch (cmd) {
      case 'pwd':
        r = ok(this.cwd + '\n');
        break;
      case 'whoami':
        r = ok('worker\n');
        break;
      case 'date':
        r = ok(new Date().toString() + '\n');
        break;
      case 'cd': {
        const target = this.resolve(ops[0] ?? '~');
        const n = this.nodes.get(target);
        if (!n) r = err(`bash: cd: ${ops[0]}: No such file or directory`);
        else if (n.type !== 'dir') r = err(`bash: cd: ${ops[0]}: Not a directory`);
        else {
          this.cwd = target;
          r = ok('');
        }
        break;
      }
      case 'ls': {
        const target = this.resolve(ops[0] ?? '.');
        const n = this.nodes.get(target);
        if (!n) {
          r = err(`ls: cannot access '${ops[0]}': No such file or directory`, 2);
          break;
        }
        const names = n.type === 'dir' ? this.children(target) : [target];
        const shown = names.filter((p) => flags.has('a') || !this.base(p).startsWith('.'));
        if (flags.has('l')) {
          r = ok(
            shown
              .map((p) => {
                const c = this.nodes.get(p)!;
                const size = c.type === 'file' ? c.content.length : 4096;
                return `${modeString(c.type, c.mode)} 1 worker worker ${String(size).padStart(5)} ${this.base(p)}`;
              })
              .map((l) => l + '\n')
              .join(''),
          );
        } else r = ok(shown.length ? shown.map((p) => this.base(p)).join('  ') + '\n' : '');
        break;
      }
      case 'mkdir': {
        let out = '';
        for (const a of ops) {
          const p = this.resolve(a);
          if (this.nodes.has(p)) {
            if (!flags.has('p')) out += `mkdir: cannot create directory ‘${a}’: File exists\n`;
            continue;
          }
          if (!flags.has('p') && !this.nodes.has(this.parent(p))) {
            out += `mkdir: cannot create directory ‘${a}’: No such file or directory\n`;
            continue;
          }
          this.mkdirp(p);
        }
        r = out ? err(out.trimEnd()) : ok('');
        if (!ops.length) r = err('mkdir: missing operand');
        break;
      }
      case 'rmdir': {
        const p = this.resolve(ops[0] ?? '');
        const n = this.nodes.get(p);
        if (!n) r = err(`rmdir: failed to remove '${ops[0]}': No such file or directory`);
        else if (this.children(p).length) r = err(`rmdir: failed to remove '${ops[0]}': Directory not empty`);
        else {
          this.nodes.delete(p);
          r = ok('');
        }
        break;
      }
      case 'touch': {
        for (const a of ops) {
          const p = this.resolve(a);
          if (!this.nodes.has(this.parent(p))) return err(`touch: cannot touch '${a}': No such file or directory`);
          if (!this.nodes.has(p)) this.writeFile(p, '');
        }
        r = ok('');
        break;
      }
      case 'cat': {
        let out = '';
        let e = '';
        for (const a of ops) {
          const n = this.nodes.get(this.resolve(a));
          if (!n) e += `cat: ${a}: No such file or directory\n`;
          else if (n.type === 'dir') e += `cat: ${a}: Is a directory\n`;
          else out += n.content;
        }
        r = { stdout: out, stderr: e, exitCode: e ? 1 : 0 };
        break;
      }
      case 'echo': {
        const words = args[0] === '-n' ? args.slice(1) : args;
        r = ok(words.join(' ') + (args[0] === '-n' ? '' : '\n'));
        break;
      }
      case 'rm': {
        let e = '';
        for (const a of ops) {
          const p = this.resolve(a);
          const n = this.nodes.get(p);
          if (!n) {
            if (!flags.has('f')) e += `rm: cannot remove '${a}': No such file or directory\n`;
            continue;
          }
          if (n.type === 'dir' && !flags.has('r')) {
            e += `rm: cannot remove '${a}': Is a directory\n`;
            continue;
          }
          for (const k of [...this.nodes.keys()]) if (k === p || k.startsWith(p + '/')) this.nodes.delete(k);
        }
        r = e ? err(e.trimEnd()) : ok('');
        break;
      }
      case 'mv':
      case 'cp': {
        if (ops.length < 2) {
          r = err(`${cmd}: missing file operand`);
          break;
        }
        const src = this.resolve(ops[0]);
        let dst = this.resolve(ops[1]);
        const n = this.nodes.get(src);
        if (!n) {
          r = err(`${cmd}: cannot stat '${ops[0]}': No such file or directory`);
          break;
        }
        if (this.nodes.get(dst)?.type === 'dir') dst = dst === '/' ? '/' + this.base(src) : `${dst}/${this.base(src)}`;
        if (!this.nodes.has(this.parent(dst))) {
          r = err(`${cmd}: cannot ${cmd === 'mv' ? 'move' : 'create regular file'} '${ops[0]}' to '${ops[1]}': No such file or directory`);
          break;
        }
        if (n.type === 'dir' && cmd === 'cp' && !flags.has('r')) {
          r = err(`cp: -r not specified; omitting directory '${ops[0]}'`);
          break;
        }
        for (const k of [...this.nodes.keys()]) {
          if (k === src || k.startsWith(src + '/')) {
            const v = this.nodes.get(k)!;
            this.nodes.set(dst + k.slice(src.length), { ...v, mtime: Date.now() });
            if (cmd === 'mv') this.nodes.delete(k);
          }
        }
        r = ok('');
        break;
      }
      case 'chmod': {
        const [mode, ...files] = args;
        if (!mode || !/^[0-7]{3,4}$/.test(mode)) {
          r = err(`chmod: invalid mode: ‘${mode ?? ''}’`);
          break;
        }
        let e = '';
        for (const f of files) {
          const n = this.nodes.get(this.resolve(f));
          if (!n) e += `chmod: cannot access '${f}': No such file or directory\n`;
          else n.mode = parseInt(mode, 8);
        }
        r = e ? err(e.trimEnd()) : files.length ? ok('') : err(`chmod: missing operand after ‘${mode}’`);
        break;
      }
      case 'tree': {
        const root = this.resolve(ops[0] ?? '.');
        const lines: string[] = [ops[0] ?? '.'];
        const walk = (p: string, pre: string) => {
          const kids = this.children(p);
          kids.forEach((k, i) => {
            const last = i === kids.length - 1;
            lines.push(`${pre}${last ? '└── ' : '├── '}${this.base(k)}`);
            if (this.nodes.get(k)!.type === 'dir') walk(k, pre + (last ? '    ' : '│   '));
          });
        };
        walk(root, '');
        r = ok(lines.join('\n') + '\n');
        break;
      }
      case 'clear':
        r = { stdout: '', stderr: '', exitCode: 0, action: { type: 'clear' } };
        break;
      case 'nano':
      case 'edit':
      case 'vi':
        if (!ops[0]) r = err(`${cmd}: missing file operand`);
        else r = { stdout: '', stderr: '', exitCode: 0, action: { type: 'edit', path: this.resolve(ops[0]) } };
        break;
      case 'help':
        r = ok(
          'Commands: pwd cd ls mkdir rmdir touch cat echo rm mv cp chmod tree whoami date clear nano edit vi help\n',
        );
        break;
      default:
        r = err(`bash: ${cmd}: command not found`, 127);
    }
    if (redirect && r.exitCode === 0) {
      if (!this.nodes.has(this.parent(redirect.path)))
        return err(`bash: ${raw[ri + 1]}: No such file or directory`);
      const prev = redirect.append ? (this.readFile(redirect.path) ?? '') : '';
      this.writeFile(redirect.path, prev + r.stdout);
      return { ...r, stdout: '' };
    }
    return r;
  }
}

function ok(stdout: string): ExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}
function err(msg: string, code = 1): ExecResult {
  return { stdout: '', stderr: msg + '\n', exitCode: code };
}

export function modeString(type: 'file' | 'dir', mode: number): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
}

/** Splits a line into commands joined by ; && ||, honouring quotes and backslashes. */
function splitCommands(line: string): string[][] {
  const out: (string[] & { op?: string })[] = [];
  let cur: string[] & { op?: string } = [];
  let word = '';
  let inWord = false;
  let pendingOp: string | undefined;
  const pushWord = () => {
    if (inWord) cur.push(word);
    word = '';
    inWord = false;
  };
  const pushCmd = (op: string) => {
    pushWord();
    cur.op = pendingOp;
    if (cur.length) out.push(cur);
    cur = [];
    pendingOp = op;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw new Error('unexpected EOF while looking for matching `\'\'');
      word += line.slice(i + 1, j);
      inWord = true;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      inWord = true;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) j++;
        word += line[j];
        j++;
      }
      if (j >= line.length) throw new Error('unexpected EOF while looking for matching `"\'');
      i = j;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (c === ' ' || c === '\t') pushWord();
    else if (c === ';') pushCmd(';');
    else if (c === '&' && line[i + 1] === '&') {
      pushCmd('&&');
      i++;
    } else if (c === '|' && line[i + 1] === '|') {
      pushCmd('||');
      i++;
    } else if (c === '|') throw new Error('pipes are not available in this terminal');
    else if (c === '>') {
      pushWord();
      if (line[i + 1] === '>') {
        cur.push('>>');
        i++;
      } else cur.push('>');
    } else {
      word += c;
      inWord = true;
    }
  }
  pushCmd(';');
  return out;
}
