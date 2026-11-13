import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIncomplete, parse, ParseError } from '../src/index.ts';
import { newShell } from './helpers.ts';

const words = (line: string): string[] => {
  const { run } = newShell();
  // printf prints each argument on its own line, bracketed, so we can see word boundaries.
  return run(`printf '[%s]\\n' ${line}`).stdout.trim().split('\n');
};

test('splits words on whitespace', () => {
  assert.deepEqual(words('a   b\tc'), ['[a]', '[b]', '[c]']);
});

test('single quotes are literal', () => {
  assert.deepEqual(words(`'a b' '$HOME' '\\n' '"x"'`), ['[a b]', '[$HOME]', '[\\n]', '["x"]']);
});

test('double quotes keep spaces and expand variables', () => {
  assert.deepEqual(words(`"a  b" "$HOME/x" "it's" "\\"q\\""`), ['[a  b]', '[/home/worker/x]', "[it's]", '["q"]']);
});

test('backslash escapes outside quotes', () => {
  assert.deepEqual(words('a\\ b \\$HOME \\"x\\" \\|'), ['[a b]', '[$HOME]', '["x"]', '[|]']);
});

test('adjacent quoted and unquoted pieces join into one word', () => {
  assert.deepEqual(words(`pre"mid dle"'post'`), ['[premid dlepost]']);
});

test('empty quotes make an empty argument', () => {
  assert.deepEqual(words(`a "" b`), ['[a]', '[]', '[b]']);
});

test('comments are ignored', () => {
  const { run } = newShell();
  assert.equal(run('echo hi # not this').stdout, 'hi\n');
  assert.equal(run('echo a#b').stdout, 'a#b\n');
});

test('parse builds pipelines and list operators', () => {
  const items = parse('a | b && c || d; e');
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.op), [null, '&&', '||', ';']);
  assert.equal(items[0].pipeline.commands.length, 2);
});

test('parse records redirects with fds', () => {
  const [item] = parse('cmd > out 2>> err < in 2>&1');
  const cmd = item.pipeline.commands[0];
  assert.equal(cmd.type, 'simple');
  const r = cmd.redirects.map((x) => [x.fd, x.op]);
  assert.deepEqual(r, [[1, '>'], [2, '>>'], [0, '<'], [2, '>&']]);
});

test('operators do not need spaces', () => {
  const { run } = newShell();
  assert.equal(run('echo a>f;cat f|wc -l&&echo ok').stdout, '1\nok\n');
});

test('syntax errors use bash wording and exit 2', () => {
  const { run } = newShell();
  const cases: [string, string][] = [
    ['echo a | | b', "bash: syntax error near unexpected token `|'\n"],
    ['| a', "bash: syntax error near unexpected token `|'\n"],
    ['; echo', "bash: syntax error near unexpected token `;'\n"],
    ['echo a ;; b', "bash: syntax error near unexpected token `;;'\n"],
    ['echo >', "bash: syntax error near unexpected token `newline'\n"],
    ['echo > | x', "bash: syntax error near unexpected token `|'\n"],
    ['echo a |', 'bash: syntax error: unexpected end of file\n'],
    ['echo a &&', 'bash: syntax error: unexpected end of file\n'],
    [`echo "abc`, 'bash: unexpected EOF while looking for matching `"\'\n'],
    [`echo 'abc`, "bash: unexpected EOF while looking for matching `''\n"],
  ];
  for (const [line, err] of cases) {
    const r = run(line);
    assert.equal(r.stderr, err, line);
    assert.equal(r.exitCode, 2, line);
    assert.equal(r.stdout, '', line);
  }
});

test('what this shell cannot do gives a clear error instead of running', () => {
  const { run } = newShell();
  for (const line of ['diff <(ls) <(ls)', 'select x in a b; do echo; done', 'coproc cat']) {
    const r = run(line);
    assert.match(r.stderr, /not supported/, line);
    assert.notEqual(r.exitCode, 0, line);
  }
  assert.throws(() => parse('echo $(x'), ParseError);
});

test('unfinished input is reported as incomplete, so the terminal can ask for more', () => {
  for (const line of ['if true; then', 'echo "abc', "echo 'x", 'for i in 1 2; do', 'cat <<EOF\nline', 'echo $(ls', 'a &&', 'f() {', 'case x in', 'echo a |', 'echo \\']) {
    assert.equal(isIncomplete(line), true, line);
  }
  for (const line of ['echo hi', 'if true; then echo; fi', 'cat <<EOF\nx\nEOF', 'echo )', '']) assert.equal(isIncomplete(line), false, line);
});

test('trailing semicolon and empty lines are fine', () => {
  const { run } = newShell();
  assert.deepEqual(run('echo a;'), { stdout: 'a\n', stderr: '', exitCode: 0 });
  assert.deepEqual(run(''), { stdout: '', stderr: '', exitCode: 0 });
  assert.deepEqual(run('   # just a comment'), { stdout: '', stderr: '', exitCode: 0 });
});
