import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { referrerHost, Stats } from '../src/stats.ts';

test('referrers keep only the host, and our own pages count as direct', () => {
  assert.equal(referrerHost('https://news.ycombinator.com/item?id=1'), 'news.ycombinator.com');
  assert.equal(referrerHost('https://old.reddit.com/r/WebGames/'), 'reddit.com');
  assert.equal(referrerHost('https://worker755.com/about', 'worker755.com'), '');
  assert.equal(referrerHost('not a url'), '');
  assert.equal(referrerHost(42), '');
});

test('a visitor counts once a day, their pages every time, and nothing about them is saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w755-stats-'));
  const s = new Stats(dir, 'worker755.com');
  s.visit({ path: '/', ref: 'https://news.ycombinator.com/', source: 'HN', lang: 'en', mobile: false }, '1.2.3.4 Firefox');
  s.visit({ path: '/r/abcdefghij', ref: 'https://worker755.com/' }, '1.2.3.4 Firefox');
  s.visit({ path: '/', ref: '', mobile: true }, '5.6.7.8 Chrome');
  s.count('shift:start');
  s.close();
  const [file] = readdirSync(dir);
  const saved = readFileSync(join(dir, file), 'utf8');
  const d = JSON.parse(saved);
  assert.equal(d.visitors, 2);
  assert.equal(d.counts['view:/'], 2);
  assert.equal(d.counts['view:/r'], 1);
  assert.equal(d.counts['ref:news.ycombinator.com'], 1);
  assert.equal(d.counts['ref:direct'], 1);
  assert.equal(d.counts['source:hn'], 1);
  assert.equal(d.counts['device:mobile'], 1);
  assert.equal(d.counts['shift:start'], 1);
  assert.doesNotMatch(saved, /1\.2\.3\.4|Firefox/);
  // A restart picks the day up again.
  const again = new Stats(dir);
  assert.equal(again.snapshot().counts['shift:start'], 1);
  again.close();
});
