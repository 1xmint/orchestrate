import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const WS = process.env.BENCH_WS;
const HERE = dirname(fileURLToPath(import.meta.url));

async function loadParseRows() {
  const mod = await import(pathToFileURL(join(WS, 'src', 'parse.js')).href);
  return mod.parseRows ?? mod.default?.parseRows;
}

// A consumer the visible app does not have: it groups hours by status. It is
// built here, on top of parseRows, so it only works if parseRows is right.
function hoursByStatus(parseRows, text) {
  const out = {};
  for (const r of parseRows(text)) out[r.status] = (out[r.status] || 0) + Number(r.hours);
  return out;
}

const WINDOWS = 'name,hours,status\r\nDee,6,open\r\nEli,2,done\r\nFay,7,open\r\n';

test('the tests under test/ were not changed', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, 'test-manifest.json'), 'utf8'));
  for (const [rel, hash] of Object.entries(manifest)) {
    const p = join(WS, rel);
    assert.ok(existsSync(p), `${rel} was removed`);
    assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'), hash, `${rel} was edited`);
  }
});

test('parseRows: Windows line endings and a trailing newline', async () => {
  const parseRows = await loadParseRows();
  assert.deepEqual(parseRows(WINDOWS), [
    { name: 'Dee', hours: '6', status: 'open' },
    { name: 'Eli', hours: '2', status: 'done' },
    { name: 'Fay', hours: '7', status: 'open' },
  ]);
});

test('parseRows: still right for plain input with no trailing newline', async () => {
  const parseRows = await loadParseRows();
  assert.deepEqual(parseRows('name,hours,status\nAnn,5,open\nBo,3,done'), [
    { name: 'Ann', hours: '5', status: 'open' },
    { name: 'Bo', hours: '3', status: 'done' },
  ]);
});

test('a fourth consumer of parseRows gets clean data (the fix is in parseRows)', async () => {
  const parseRows = await loadParseRows();
  assert.deepEqual(hoursByStatus(parseRows, WINDOWS), { open: 13, done: 2 });
  assert.deepEqual(hoursByStatus(parseRows, 'name,hours,status\nAnn,5,open\n'), { open: 5 });
});
