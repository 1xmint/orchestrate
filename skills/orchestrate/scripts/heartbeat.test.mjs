// heartbeat.test.mjs — the marathon-handoff and idle nudges in turn-check, as
// pure decisions over a stored record. No files, no model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heartbeatDecision, MARATHON_FIRST, MARATHON_EVERY, IDLE_READY_MIN } from './turn-check.mjs';

test('marathon fires at the first threshold and re-arms further out', () => {
  const at149 = heartbeatDecision({ run: {}, rec: { turns: MARATHON_FIRST - 1 } });
  assert.equal(at149.kind, 'marathon');
  assert.equal(at149.rec.turns, MARATHON_FIRST);
  assert.equal(at149.rec.marathonNext, MARATHON_FIRST + MARATHON_EVERY);

  const justBefore = heartbeatDecision({ run: {}, rec: { turns: MARATHON_FIRST - 2 } });
  assert.equal(justBefore.kind, null, 'one turn early, it says nothing');

  // After it fired once, it stays quiet until the re-armed threshold.
  const after = heartbeatDecision({ run: {}, rec: { turns: MARATHON_FIRST + 5, marathonNext: MARATHON_FIRST + MARATHON_EVERY } });
  assert.equal(after.kind, null);
});

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

test('a marathon outranks an idle nudge on the same turn', () => {
  const d = heartbeatDecision({ run: { ready: ['a', 'b', 'c'] }, rec: { turns: MARATHON_FIRST - 1 } });
  assert.equal(d.kind, 'marathon', 'hand off before starting more work in a session that is already too long');
});

test('the turn counter advances even on a quiet turn', () => {
  const d = heartbeatDecision({ run: { ready: [] }, rec: { turns: 10 } });
  assert.equal(d.kind, null);
  assert.equal(d.rec.turns, 11);
});
