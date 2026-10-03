// lib/session-save.test.mjs — hooks that write the session file at the same
// time keep each other's writes. Each case runs in its own Node process with
// its own HOME, since lib/tier.mjs reads HOME when it loads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TIER = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'tier.mjs')).href;
const sessionFile = home => join(home, '.claude', 'orchestrate', 'sessions', 's1.json');
const script = body => `import { loadSession, saveSession } from ${JSON.stringify(TIER)};\n${body}`;
const runIn = (home, body) => spawnSync(process.execPath, ['--input-type=module', '-e', script(body)], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });

test('a save writes back only what this writer changed, and keeps what another wrote meanwhile', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-save-'));
  mkdirSync(dirname(sessionFile(home)), { recursive: true });
  writeFileSync(sessionFile(home), JSON.stringify({ v: 1, session_id: 's1', returned: [], workCalls: { count: 3 }, gone: true }));
  const r = runIn(home, `
    const a = loadSession('s1');            // the hook after a tool call
    const b = loadSession('s1');            // the hook that files a helper's return
    b.returned = [{ agentId: 'h1', verdict: 'PASS' }];
    saveSession(b);
    a.workCalls = { count: 4 };
    delete a.gone;
    saveSession(a);                         // loaded before b saved
    const c = { v: 1, session_id: 's1', fresh: 1 };  // a state nobody loaded
    saveSession(c);
  `);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(sessionFile(home), 'utf8'));
  assert.deepEqual(s.returned, [{ agentId: 'h1', verdict: 'PASS' }], 'the return row survives the other hook\'s save');
  assert.deepEqual(s.workCalls, { count: 4 });
  assert.equal('gone' in s, false, 'a key the writer deleted is deleted');
  assert.equal(s.fresh, 1, 'a new object adds its keys');
  assert.ok(Array.isArray(s.returned), 'and drops none of the others');
  assert.equal(existsSync(`${sessionFile(home)}.lock`), false, 'no lock is left behind');
});

test('hooks saving at the same moment from separate processes lose none of each other\'s keys', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-save-race-'));
  mkdirSync(dirname(sessionFile(home)), { recursive: true });
  writeFileSync(sessionFile(home), JSON.stringify({ v: 1, session_id: 's1' }));
  const writers = Array.from({ length: 6 }, (_, i) => new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script(`
      const s = loadSession('s1');
      const until = Date.now() + 40; while (Date.now() < until) {}   // hold the loaded copy a while
      s['k${i}'] = ${i};
      saveSession(s);
    `)], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'ignore' });
    p.on('exit', resolve);
  }));
  await Promise.all(writers);
  const s = JSON.parse(readFileSync(sessionFile(home), 'utf8'));
  for (let i = 0; i < 6; i++) assert.equal(s[`k${i}`], i, `writer ${i}'s key survives`);
});

test('updateSession: appends to one list from separate processes keep every row', async () => {
  // Two hooks adding to the same list (a dispatch row and a return row, or two
  // returns) each load, add and write under the lock, so neither drops the
  // other's row, which a merge of changed keys alone cannot promise.
  const home = mkdtempSync(join(tmpdir(), 'orch-update-race-'));
  mkdirSync(dirname(sessionFile(home)), { recursive: true });
  writeFileSync(sessionFile(home), JSON.stringify({ v: 1, session_id: 's1', returned: [] }));
  // Every writer waits for the same moment, so the three really collide; the
  // locked steps take about 30 ms in all, well inside the lock's wait.
  const go = Date.now() + 600;
  const body = i => `import { updateSession } from ${JSON.stringify(TIER)};
    while (Date.now() < ${go}) {}
    updateSession('s1', s => {
      const until = Date.now() + 8; while (Date.now() < until) {}   // a slow write
      s.returned = Array.isArray(s.returned) ? s.returned : [];
      s.returned.push({ agentId: 'h${i}' });
    });`;
  const writers = Array.from({ length: 3 }, (_, i) => new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', body(i)], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'ignore' });
    p.on('exit', resolve);
  }));
  await Promise.all(writers);
  const s = JSON.parse(readFileSync(sessionFile(home), 'utf8'));
  assert.deepEqual(s.returned.map(r => r.agentId).sort(), ['h0', 'h1', 'h2']);
  assert.equal(existsSync(`${sessionFile(home)}.lock`), false, 'no lock is left behind');
});

test('updateSession: no file and no starting state changes nothing; with one, the file is made', () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-update-new-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { updateSession } from ${JSON.stringify(TIER)};
    const a = updateSession('s1', s => { s.x = 1; return 'ran'; });
    const b = updateSession('s1', s => { s.returned = [{ agentId: 'h1' }]; return 'ran'; }, () => ({ v: 1, session_id: 's1' }));
    const c = updateSession('s1', s => { s.x = 2; return false; });
    console.log(JSON.stringify([a, b, c]));`], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), [null, 'ran', false]);
  const s = JSON.parse(readFileSync(sessionFile(home), 'utf8'));
  assert.equal(s.x, undefined, 'the first call had no file and no starting state, and the third said it changed nothing');
  assert.deepEqual(s.returned, [{ agentId: 'h1' }]);
});

test('putEntry: sessions stopping at the same moment keep each other\'s entries', async () => {
  // The Stop hooks' shared records were written whole, so a second session's
  // Stop dropped the first's loop record.
  const home = mkdtempSync(join(tmpdir(), 'orch-store-race-'));
  const path = join(home, 'persist-checks.json');
  writeFileSync(path, JSON.stringify({ earlier: { steps: 7 } }));
  const go = Date.now() + 600;
  const writers = Array.from({ length: 3 }, (_, i) => new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', `import { putEntry } from ${JSON.stringify(TIER)};
      while (Date.now() < ${go}) {}
      putEntry(${JSON.stringify(path)}, 's${i}', { steps: ${i} });`], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'ignore' });
    p.on('exit', resolve);
  }));
  await Promise.all(writers);
  const s = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(s).sort(), ['earlier', 's0', 's1', 's2']);
  assert.equal(existsSync(`${path}.lock`), false);
});
