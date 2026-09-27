// turn-check.test.mjs — the session Stop heartbeat: the exported pure
// decisions (shouldBlock, heartbeatDecision, pickupSection) and the hook
// process's stdin/stdout contract.
//   node --test skills/orchestrate/scripts/turn-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldBlock, heartbeatDecision, pickupSection, pickupHash, pickupWritten, IDLE_READY_MIN } from './turn-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'turn-check.mjs');

function run(input, home = mkdtempSync(join(tmpdir(), 'orch-turncheck-home-'))) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout, status: r.status };
}

// ---- pickupSection / pickupWritten ---------------------------------------------

test('pickupSection extracts the text between the Pickup heading and the next heading', () => {
  const md = '## Goal\nfoo\n\n## Pickup\nPickup prompt: do the next thing\n\n## Other\nbar\n';
  assert.equal(pickupSection(md), 'Pickup prompt: do the next thing');
});

test('pickupSection is empty when there is no Pickup heading at all', () => {
  assert.equal(pickupSection('## Goal\nfoo\n'), '');
});

test('pickupWritten is false for a template placeholder and true for real text', () => {
  assert.equal(pickupWritten('Pickup prompt: <what to say next>'), false);
  assert.equal(pickupWritten('Pickup prompt: continue with step 3'), true);
  assert.equal(pickupWritten(''), false);
});

// ---- shouldBlock ----------------------------------------------------------------

test('shouldBlock is quiet when nothing has been dispatched this session', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: '', lastDispatchAt: null, prev: {} });
  assert.equal(d.block, false);
});

test('shouldBlock blocks once when the Pickup was never written', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: <fill in>', lastDispatchAt: '2026-01-01T00:00:00Z', prev: {} });
  assert.equal(d.block, true);
  assert.match(d.why, /never been written/);
});

test('shouldBlock is quiet once it already blocked for this exact text', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: x', lastDispatchAt: '2026-01-01T00:00:00Z', prev: { blockedFor: 'h1' } });
  assert.equal(d.block, false);
  assert.match(d.why, /already blocked/);
});

test('shouldBlock is quiet when the Pickup text changed since the last check', () => {
  const d = shouldBlock({ pickupHash: 'h2', section: 'Pickup prompt: new text', lastDispatchAt: '2026-01-01T00:00:00Z', prev: { hash: 'h1' } });
  assert.equal(d.block, false);
  assert.match(d.why, /changed since/);
});

test('shouldBlock blocks when the hash is unchanged and a dispatch happened after the last check', () => {
  const d = shouldBlock({ pickupHash: 'h1', section: 'Pickup prompt: same text', lastDispatchAt: '2026-01-02T00:00:00Z', prev: { hash: 'h1', checkedAt: '2026-01-01T00:00:00Z' } });
  assert.equal(d.block, true);
  assert.match(d.why, /has not changed since the last dispatch/);
});

// ---- heartbeatDecision ------------------------------------------------------------

test('heartbeatDecision fires the idle nudge once, for at least IDLE_READY_MIN unblocked tasks', () => {
  const ready = Array.from({ length: IDLE_READY_MIN }, (_, i) => `task-${i}`);
  const first = heartbeatDecision({ run: { ready }, rec: {} });
  assert.equal(first.kind, 'idle');
  assert.match(first.why, /tasks are unblocked/);
  const again = heartbeatDecision({ run: { ready }, rec: first.rec });
  assert.equal(again.kind, null, 'same ready set already flagged, so quiet the second time');
});

test('heartbeatDecision advances the turn counter even when there is nothing to say', () => {
  const d = heartbeatDecision({ run: { ready: [] }, rec: { turns: 4 } });
  assert.equal(d.kind, null);
  assert.equal(d.rec.turns, 5);
});

test('heartbeatDecision does not nudge when fewer than IDLE_READY_MIN tasks are ready', () => {
  const d = heartbeatDecision({ run: { ready: ['only-one'] }, rec: {} });
  assert.equal(d.kind, null);
});

// ---- hook process: stdin/stdout contract ---------------------------------------

test('a malformed JSON payload exits 0 and writes nothing', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'orch-turncheck-home-')) } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('stop_hook_active suppresses the check so it never blocks its own Stop again', () => {
  const r = run({ hook_event_name: 'Stop', session_id: 's1', stop_hook_active: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('a session with no run explicitly bound is silent, agent_id or not', () => {
  const withAgent = run({ hook_event_name: 'Stop', session_id: 'unbound-session', agent_id: 'helper-1' });
  assert.equal(withAgent.status, 0);
  assert.equal(withAgent.stdout.trim(), '');
  const withoutAgent = run({ hook_event_name: 'Stop', session_id: 'unbound-session-2' });
  assert.equal(withoutAgent.status, 0);
  assert.equal(withoutAgent.stdout.trim(), '');
});
