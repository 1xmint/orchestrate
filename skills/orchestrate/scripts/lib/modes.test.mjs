// modes.test.mjs — what the host's reported permission mode means for a
// session, and the one-time notice a mode change produces.
//   node --test skills/orchestrate/scripts/lib/modes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeOf, modeTransition, modeNote, PLAN_NOTE, APPROVED_NOTE } from './modes.mjs';

test('modeOf reads a known mode from the payload and nothing else', () => {
  assert.equal(modeOf({ permission_mode: 'plan' }), 'plan');
  assert.equal(modeOf({ permission_mode: 'bypassPermissions' }), 'bypassPermissions');
});

test('modeOf is null for an unknown or missing mode', () => {
  assert.equal(modeOf({ permission_mode: 'sudo' }), null);
  assert.equal(modeOf({}), null);
  assert.equal(modeOf(null), null);
});

test('entering plan mode notes it; leaving it notes the approval', () => {
  const enter = modeTransition('default', 'plan');
  assert.equal(enter.note, PLAN_NOTE);
  assert.equal(enter.mode, 'plan');
  const leave = modeTransition('plan', 'default');
  assert.equal(leave.note, APPROVED_NOTE);
  assert.equal(leave.mode, 'default');
});

test('an unchanged mode, or a host that reports no mode at all, says nothing', () => {
  assert.deepEqual(modeTransition('default', 'default'), { note: '', mode: 'default' });
  const t = modeTransition('plan', null);
  assert.equal(t.note, '', 'an unreported mode never claims the session left plan');
  assert.equal(t.mode, 'plan', 'the remembered mode is unchanged');
});

test('modeNote mutates the session state in place and returns the note', () => {
  const state = { mode: null };
  const note = modeNote(state, { permission_mode: 'plan' });
  assert.equal(note, PLAN_NOTE);
  assert.equal(state.mode, 'plan');
  // A second call with the same mode says nothing further.
  assert.equal(modeNote(state, { permission_mode: 'plan' }), '');
});

test('modeNote on a null state is a no-op that returns empty', () => {
  assert.equal(modeNote(null, { permission_mode: 'plan' }), '');
});
