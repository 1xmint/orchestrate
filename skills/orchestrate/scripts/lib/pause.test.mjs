// lib/pause.test.mjs — the pause record's pure parts: its shape, how a record
// is read back, and who may clear it. The hook runs that write and clear it are
// in persist-pause.test.mjs.
//   node --test skills/orchestrate/scripts/lib/pause.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pauseRecord, parsePause, readPause, writePause, clearPause, pausePath, pauseRoot, errorKind, PAUSE_REL, PAUSE_KINDS } from './pause.mjs';

const NOW = new Date('2026-10-03T09:00:00.000Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'orch-pause-lib-'));

test('a rate_limit is a usage_limit record with the spec wording', () => {
  assert.deepEqual(pauseRecord({ error: 'rate_limit', session: 's1', now: NOW }), {
    kind: 'usage_limit',
    error: 'rate_limit',
    at: '2026-10-03T09:00:00.000Z',
    session: 's1',
    text: 'Paused for the usage limit; keep-going stays on.',
  });
});

test('every other kind is an api_error record that names the kind', () => {
  assert.deepEqual(pauseRecord({ error: 'overloaded', session: 's1', now: NOW }), {
    kind: 'api_error',
    error: 'overloaded',
    at: '2026-10-03T09:00:00.000Z',
    session: 's1',
    text: 'Stopped on an API error (overloaded); keep-going stays on.',
  });
});

test('keep-going is said to stay on only when it is armed', () => {
  assert.equal(pauseRecord({ error: 'rate_limit', now: NOW, armed: false }).text, 'Paused for the usage limit.');
  assert.equal(pauseRecord({ error: 'server_error', now: NOW, armed: false }).text, 'Stopped on an API error (server_error).');
});

test('an error the payload did not give, or gave in a shape nobody documented, is unknown, never guessed', () => {
  for (const raw of [undefined, null, '', '   ', 42, { type: 'rate_limit' }, ['rate_limit']]) {
    assert.equal(errorKind(raw), 'unknown');
    assert.equal(pauseRecord({ error: raw, now: NOW }).kind, 'api_error');
  }
  assert.equal(errorKind('  overloaded '), 'overloaded');
  assert.equal(errorKind('x'.repeat(200)).length, 64, 'a long value is clipped, not written whole');
  assert.equal(pauseRecord({ error: 'rate_limit', now: NOW }).session, null, 'no session id on the payload is null');
});

test('parsePause accepts a record, cleared or not, and refuses anything else', () => {
  const rec = pauseRecord({ error: 'rate_limit', session: 's1', now: NOW });
  assert.deepEqual(parsePause(JSON.stringify(rec)), rec);
  assert.ok(parsePause(JSON.stringify({ ...rec, cleared: NOW.toISOString() })));
  for (const bad of ['', 'not json', 'null', '[]', '"x"', '{}', JSON.stringify({ ...rec, kind: 'other' }), JSON.stringify({ ...rec, at: 5 }), JSON.stringify({ ...rec, text: null })]) {
    assert.equal(parsePause(bad), null, String(bad));
  }
});

test('the record lives in the project .orchestrator folder', () => {
  assert.equal(pausePath('/p'), join('/p', '.orchestrator', 'pause.json'));
  assert.equal(PAUSE_REL, join('.orchestrator', 'pause.json'));
});

test('pauseRoot is the git root of the folder, else the folder, else nothing', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, 'a', 'b'), { recursive: true });
  assert.equal(pauseRoot(join(repo, 'a', 'b')), repo);
  const plain = tmp();
  assert.equal(pauseRoot(plain), plain);
  for (const none of [undefined, null, '', 7]) assert.equal(pauseRoot(none), null);
});

test('readPause reads what writePause wrote, and nothing from a missing or broken file', () => {
  const dir = tmp();
  assert.equal(readPause(dir), null, 'no file');
  assert.equal(readPause(null), null);
  const rec = pauseRecord({ error: 'rate_limit', session: 's1', now: NOW });
  assert.equal(writePause(dir, rec), true);
  assert.deepEqual(readPause(dir), rec);
  writeFileSync(pausePath(dir), '{ half a record');
  assert.equal(readPause(dir), null, 'a broken file reads as no pause, and throws nothing');
  assert.equal(writePause(null, rec), false);
});

test('readPause with a session shows only that session\'s pause', () => {
  const dir = tmp();
  writePause(dir, pauseRecord({ error: 'rate_limit', session: 's1', now: NOW }));
  assert.ok(readPause(dir, { session: 's1' }));
  assert.equal(readPause(dir, { session: 's2' }), null);
  assert.ok(readPause(dir), 'without a session it is anyone\'s');
  writePause(dir, pauseRecord({ error: 'rate_limit', now: NOW }));
  assert.equal(readPause(dir, { session: 's1' }), null, 'a record with no session is not any session\'s own');
});

test('clearPause marks the same session\'s record, keeps what it said, and is not repeated', () => {
  const dir = tmp();
  const rec = pauseRecord({ error: 'rate_limit', session: 's1', now: NOW });
  writePause(dir, rec);
  assert.equal(clearPause(dir, 's1', 'stop', new Date('2026-10-03T09:30:00.000Z')), true);
  assert.equal(readPause(dir), null);
  const kept = JSON.parse(readFileSync(pausePath(dir), 'utf8'));
  assert.deepEqual(kept, { ...rec, cleared: '2026-10-03T09:30:00.000Z', clearedBy: 'stop' });
  assert.equal(clearPause(dir, 's1', 'prompt'), false, 'already cleared: nothing written');
  assert.equal(JSON.parse(readFileSync(pausePath(dir), 'utf8')).clearedBy, 'stop');
});

test('clearPause leaves another session\'s record alone; a record with no session is anyone\'s to clear', () => {
  const dir = tmp();
  writePause(dir, pauseRecord({ error: 'rate_limit', session: 's1', now: NOW }));
  assert.equal(clearPause(dir, 's2', 'stop'), false);
  assert.equal(clearPause(dir, undefined, 'stop'), false, 'a payload with no session id clears nobody\'s');
  assert.ok(readPause(dir));
  writePause(dir, pauseRecord({ error: 'rate_limit', now: NOW }));
  assert.equal(clearPause(dir, 's2', 'prompt'), true);
  assert.equal(readPause(dir), null);
});

test('clearing with no folder, or no file, writes nothing and throws nothing', () => {
  assert.equal(clearPause(null, 's1', 'stop'), false);
  const dir = tmp();
  assert.equal(clearPause(dir, 's1', 'stop'), false);
  assert.equal(existsSync(join(dir, '.orchestrator')), false, 'no folder made just to clear nothing');
});

test('docs/pause.md names the file, the kinds and every field the record carries', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const doc = readFileSync(join(root, 'docs', 'pause.md'), 'utf8');
  assert.ok(doc.includes(PAUSE_REL.replace(/\\/g, '/')), 'the doc says where the record lives');
  for (const kind of PAUSE_KINDS) assert.ok(doc.includes(kind), `the doc names the ${kind} kind`);
  for (const key of Object.keys(pauseRecord({ error: 'rate_limit', now: NOW }))) assert.ok(doc.includes(`"${key}"`), `the doc's sample record shows ${key}`);
  assert.ok(doc.includes('StopFailure'), 'the doc says which host moment writes it');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('docs/pause.md'), 'the README points at the page');
});
