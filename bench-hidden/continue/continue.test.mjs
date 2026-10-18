import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WS = process.env.BENCH_WS;
const CLI = join(WS, 'src', 'cli.js');

const baseEnv = () => {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  return e;
};

// Each test works in its own scratch folder outside the workspace, with its own
// recipe file, so the workspace is never written to.
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-'));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...baseEnv(), RECIPES_FILE: join(dir, 'recipes.json') };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env, timeout: 20000 });
  for (const args of [
    ['add', 'Pancakes', 'flour', 'eggs', 'milk'],
    ['add', 'Omelette', 'eggs', 'cheese'],
    ['add', 'Bread', 'flour', 'water', 'yeast', 'salt'],
  ]) assert.equal(cli(...args).status, 0, `add ${args[1]} failed`);
  return { dir, cli };
}

test('item 1 still works: add saves recipes', () => {
  const { dir, cli } = scratch();
  assert.ok(existsSync(join(dir, 'recipes.json')));
  assert.equal(cli('add', 'Toast', 'bread').status, 0);
});

test('item 2: list prints each recipe with its ingredient count', () => {
  const { cli } = scratch();
  const r = cli('list');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.equal(lines.length, 3, `expected one line per recipe, got:\n${r.stdout}`);
  const want = [['Pancakes', '3'], ['Omelette', '2'], ['Bread', '4']];
  for (const [name, n] of want) {
    const line = lines.find((l) => l.includes(name));
    assert.ok(line, `no line for ${name}`);
    assert.match(line, new RegExp(`(^|\\D)${n}(\\D|$)`), `no count ${n} on: ${line}`);
  }
});

test('item 3: search prints the recipes that use the ingredient, and only those', () => {
  const { cli } = scratch();
  const r = cli('search', 'flour');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Pancakes') && r.stdout.includes('Bread'), `missing a match:\n${r.stdout}`);
  assert.ok(!r.stdout.includes('Omelette'), `Omelette does not use flour:\n${r.stdout}`);
  const none = cli('search', 'saffron');
  assert.ok(!/Pancakes|Omelette|Bread/.test(none.stdout), `nothing uses saffron:\n${none.stdout}`);
});

test('Later item not started: export writes no file', () => {
  const { dir, cli } = scratch();
  cli('export', 'recipes.md');
  cli('export');
  const made = readdirSync(dir).filter((f) => f !== 'recipes.json');
  assert.deepEqual(made, [], `export produced: ${made.join(', ')}`);
});
