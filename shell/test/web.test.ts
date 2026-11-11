import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../src/index.ts';
import type { Web } from '../src/index.ts';

const WEB: Web = {
  search: (q) =>
    q.includes('port')
      ? [
          { url: 'https://ads.example/', title: 'Buy now', snippet: 'Ad.', sponsored: true },
          { url: 'https://docs.example/port', title: 'Port', snippet: 'It is 7443.' },
        ]
      : [],
  fetch: (url) => {
    if (!url.startsWith('https://docs.example/') && !url.startsWith('http://docs.example/')) return null;
    return url.endsWith('/port')
      ? { url, title: 'Port', body: 'The port is 7443.\n' }
      : { url, title: 'Not Found', body: '404 Not Found\n', status: 404 };
  },
};

function shell(web?: Web) {
  const sh = createShell({ now: () => 0, web });
  return { sh, run: (line: string) => sh.exec(line) };
}

test('websearch lists results with the advert marked, and says when nothing matches', () => {
  const { run } = shell(WEB);
  const r = run('websearch default port');
  assert.equal(r.exitCode, 0);
  assert.equal(
    r.stdout,
    '1. [Sponsored] Buy now\n   https://ads.example/\n   Ad.\n\n2. Port\n   https://docs.example/port\n   It is 7443.\n',
  );
  assert.equal(run('websearch cats').stdout, 'No results for "cats".\n');
  assert.equal(run('websearch').exitCode, 2);
});

test('curl prints pages, saves them, fails like curl on bad hosts and missing pages', () => {
  const { sh, run } = shell(WEB);
  assert.equal(run('curl -s https://docs.example/port').stdout, 'The port is 7443.\n');
  assert.equal(run('curl docs.example/port').stdout, 'The port is 7443.\n');
  assert.deepEqual(
    [run('curl https://nowhere.example/').stderr, run('curl https://nowhere.example/').exitCode],
    ['curl: (6) Could not resolve host: nowhere.example\n', 6],
  );
  assert.equal(run('curl https://docs.example/missing').stdout, '404 Not Found\n');
  const failed = run('curl -sf https://docs.example/missing');
  assert.deepEqual([failed.stderr, failed.exitCode], ['curl: (22) The requested URL returned error: 404\n', 22]);
  assert.equal(run('curl -o page.txt https://docs.example/port').exitCode, 0);
  assert.equal(sh.fs.readFile('/home/worker/page.txt'), 'The port is 7443.\n');
  assert.equal(run('curl -O https://docs.example/port').exitCode, 0);
  assert.equal(sh.fs.readFile('/home/worker/port'), 'The port is 7443.\n');
  assert.match(run('curl -I https://docs.example/port').stdout, /^HTTP\/1\.1 200 OK\r\n/);
  assert.equal(run('curl').exitCode, 2);
  assert.match(run('curl --frobnicate x').stderr, /is unknown/);
});

test('without a network the machine is offline', () => {
  const { run } = shell();
  assert.deepEqual([run('websearch port').stderr, run('websearch port').exitCode], ['websearch: network is unreachable\n', 1]);
  assert.equal(run('curl https://docs.example/port').exitCode, 6);
});

test('grep prints context lines like GNU grep', () => {
  const { sh, run } = shell();
  sh.fs.writeFile('/home/worker/a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n');
  sh.fs.writeFile('/home/worker/b.txt', 'four again\n');
  assert.equal(run('grep -n -A1 four a.txt').stdout, '4:four\n5-five\n');
  assert.equal(run('grep -B2 six a.txt').stdout, 'four\nfive\nsix\n');
  assert.equal(run('grep -C1 -e two a.txt').stdout, 'one\ntwo\nthree\n');
  assert.equal(run('grep -A1 -e one -e x a.txt').stdout.split('\n')[0], 'one');
  assert.equal(run('grep -A1 f a.txt').stdout, 'four\nfive\nsix\n');
  assert.equal(run('grep -A1 four a.txt b.txt').stdout, 'a.txt:four\na.txt-five\n--\nb.txt:four again\n');
  assert.equal(run('grep -A0 two a.txt').stdout, 'two\n');
  assert.deepEqual([run('grep -A x two a.txt').stderr, run('grep -A x two a.txt').exitCode], ['grep: x: invalid context length argument\n', 2]);
  assert.equal(run('grep -c -A2 o a.txt').stdout, '3\n');
});
