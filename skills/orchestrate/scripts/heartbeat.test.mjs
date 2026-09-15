// heartbeat.test.mjs — the idle nudge in turn-check, as a pure decision over a
// stored record. No files, no model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeatDecision, IDLE_READY_MIN } from './turn-check.mjs';

test('idle fires when two or more tasks are ready, once per ready set', () => {
  const first = heartbeatDecision({ run: { ready: ['9-9-0005', '9-9-0006'] }, rec: { turns: 3 } });
  assert.equal(first.kind, 'idle');
  assert.match(first.why, /2 tasks are unblocked/);
  assert.equal(first.rec.readyBlockedFor, '9-9-0005,9-9-0006');

  // Same set again: quiet.
  const again = heartbeatDecision({ run: { ready: ['9-9-0006', '9-9-0005'] }, rec: first.rec });
  assert.equal(again.kind, null, 'the same unblocked set is not nagged twice');

  // The set grows: it speaks again.
  const grew = heartbeatDecision({ run: { ready: ['9-9-0005', '9-9-0006', '9-9-0007'] }, rec: again.rec });
  assert.equal(grew.kind, 'idle');
});

test('one ready task is not enough to nudge', () => {
  assert.equal(heartbeatDecision({ run: { ready: ['9-9-0005'] }, rec: { turns: 2 } }).kind, null);
  assert.ok(IDLE_READY_MIN >= 2);
});

test('the turn counter advances even on a quiet turn', () => {
  const d = heartbeatDecision({ run: { ready: [] }, rec: { turns: 10 } });
  assert.equal(d.kind, null);
  assert.equal(d.rec.turns, 11);
});
