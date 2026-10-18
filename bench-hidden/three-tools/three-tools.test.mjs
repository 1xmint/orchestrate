import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const WS = process.env.BENCH_WS;
const run = (cmd, input) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [join(WS, 'cli.js'), cmd], { input, encoding: 'utf8', env, timeout: 10000 });
  return { out: r.stdout, err: r.stderr, code: r.status };
};
const csv = (input) => JSON.parse(run('csv-to-json', input).out);

test('wordcount: empty input is 0', () => {
  assert.equal(run('wordcount', '').out.trim(), '0');
});
test('wordcount: runs of spaces and a trailing newline', () => {
  assert.equal(run('wordcount', 'one  two   three\nfour\n\n five \n').out.trim(), '5');
});
test('wordcount: CRLF line endings', () => {
  assert.equal(run('wordcount', 'one two\r\nthree\r\nfour five\r\n').out.trim(), '5');
});
test('csv-to-json: quoted field with a comma', () => {
  assert.deepEqual(csv('name,city\n"Smith, Ann",Paris\nBo,"Rome"\n'),
    [{ name: 'Smith, Ann', city: 'Paris' }, { name: 'Bo', city: 'Rome' }]);
});
test('csv-to-json: doubled quote inside quotes', () => {
  assert.deepEqual(csv('a,b\n"say ""hi""",x\n'), [{ a: 'say "hi"', b: 'x' }]);
});
test('csv-to-json: CRLF and a trailing newline add nothing extra', () => {
  assert.deepEqual(csv('name,city\r\nAnn,Paris\r\nBo,Rome\r\n'),
    [{ name: 'Ann', city: 'Paris' }, { name: 'Bo', city: 'Rome' }]);
});
test('csv-to-json: empty input and header-only input give []', () => {
  assert.deepEqual(csv(''), []);
  assert.deepEqual(csv('name,city\n'), []);
});
test('dedupe-lines: first occurrence kept, order kept, no phantom blank line', () => {
  assert.equal(run('dedupe-lines', 'a\nb\na\nc\nb\n').out, 'a\nb\nc\n');
  assert.equal(run('dedupe-lines', 'x\ny\nx').out, 'x\ny\n');
});
test('dedupe-lines: CRLF input, \\n output', () => {
  assert.equal(run('dedupe-lines', 'a\r\nb\r\na\r\nc\r\n').out, 'a\nb\nc\n');
});
