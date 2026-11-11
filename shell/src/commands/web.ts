// Network commands over a web the host supplies (ShellOptions.web): websearch and curl.
// Without one, the machine behaves as if it were offline.

import type { Command } from './context.ts';
import { abs, msgOf } from './context.ts';
import type { WebPage } from '../types.ts';

export const websearch: Command = (ctx) => {
  const query = ctx.args.join(' ').trim();
  if (!query) {
    ctx.err('usage: websearch QUERY\n');
    return 2;
  }
  const web = ctx.state.web;
  if (!web) {
    ctx.err('websearch: network is unreachable\n');
    return 1;
  }
  const results = web.search(query);
  if (!results.length) {
    ctx.out(`No results for "${query}".\n`);
    return 0;
  }
  ctx.out(
    results
      .map((r, i) => `${i + 1}. ${r.sponsored ? '[Sponsored] ' : ''}${r.title}\n   ${r.url}\n   ${r.snippet}\n`)
      .join('\n'),
  );
  return 0;
};

/** http(s)://host/path from what the user typed; null when it is not a URL. */
export function parseUrl(raw: string): { url: string; host: string } | null {
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  const m = /^(https?):\/\/([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(s);
  if (!m) return null;
  const host = m[2].toLowerCase();
  const path = m[3] || '/';
  return { url: `${m[1].toLowerCase()}://${host}${path}`, host };
}

const VALUE_OPTS = new Set(['-o', '--output', '-H', '--header', '-A', '--user-agent', '-X', '--request', '-d', '--data', '-e', '--referer', '-m', '--max-time', '-u', '--user']);

function headers(page: WebPage, status: number): string {
  const reason = status === 200 ? 'OK' : 'Not Found';
  return `HTTP/1.1 ${status} ${reason}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${page.body.length}\r\n\r\n`;
}

export const curl: Command = (ctx) => {
  let fail = false;
  let output: string | null = null;
  let remoteName = false;
  let include = false;
  let head = false;
  let method = 'GET';
  const urls: string[] = [];
  const args = ctx.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_OPTS.has(a)) {
      const v = args[++i];
      if (v === undefined) {
        ctx.err(`curl: option ${a}: requires parameter\ncurl: try 'curl --help' for more information\n`);
        return 2;
      }
      if (a === '-o' || a === '--output') output = v;
      if (a === '-X' || a === '--request') method = v.toUpperCase();
      if (a === '-d' || a === '--data') method = method === 'GET' ? 'POST' : method;
      continue;
    }
    if (a.startsWith('--')) {
      if (a === '--fail') fail = true;
      else if (a === '--include') include = true;
      else if (a === '--head') head = true;
      else if (a === '--remote-name') remoteName = true;
      else if (!['--silent', '--show-error', '--location', '--compressed', '--insecure'].includes(a)) {
        ctx.err(`curl: option ${a}: is unknown\ncurl: try 'curl --help' for more information\n`);
        return 2;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (const f of a.slice(1)) {
        if (f === 'f') fail = true;
        else if (f === 'i') include = true;
        else if (f === 'I') head = true;
        else if (f === 'O') remoteName = true;
        else if (!'sSLkv'.includes(f)) {
          ctx.err(`curl: option -${f}: is unknown\ncurl: try 'curl --help' for more information\n`);
          return 2;
        }
      }
      continue;
    }
    urls.push(a);
  }
  if (!urls.length) {
    ctx.err("curl: no URL specified!\ncurl: try 'curl --help' for more information\n");
    return 2;
  }
  const web = ctx.state.web;
  let status = 0;
  for (const raw of urls) {
    const parsed = parseUrl(raw);
    if (!parsed) {
      ctx.err(`curl: (3) URL using bad/illegal format or missing URL\n`);
      status = 3;
      continue;
    }
    const page = web?.fetch(parsed.url) ?? null;
    if (!page) {
      ctx.err(`curl: (6) Could not resolve host: ${parsed.host}\n`);
      status = 6;
      continue;
    }
    const code = method === 'GET' || method === 'HEAD' ? (page.status ?? 200) : 405;
    if (fail && code >= 400) {
      ctx.err(`curl: (22) The requested URL returned error: ${code}\n`);
      status = 22;
      continue;
    }
    const body = code === 405 ? 'Method Not Allowed\n' : page.body.endsWith('\n') ? page.body : page.body + '\n';
    const text = head ? headers(page, code) : (include ? headers(page, code) : '') + body;
    const target = output ?? (remoteName ? parsed.url.slice(parsed.url.lastIndexOf('/') + 1) || '' : null);
    if (remoteName && target === '') {
      ctx.err('curl: Remote file name has no length!\n');
      status = 23;
      continue;
    }
    if (target === null || target === '-') {
      ctx.out(text);
      continue;
    }
    try {
      ctx.fs.writeFile(abs(ctx, target), text);
    } catch (e) {
      ctx.err(`curl: (23) Failure writing output to destination: ${target}: ${msgOf(e)}\n`);
      status = 23;
    }
  }
  return status;
};
