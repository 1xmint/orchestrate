// lib/wait-claim.test.mjs — which closing messages promise that this session
// will wait or check back, and when the Stop payload says nothing is out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsWait, nothingOut, WAIT_FACT } from './wait-claim.mjs';

test('a promise to wait, watch or check back is a claim', () => {
  for (const text of [
    "Pushed. I'll let you know when CI finishes.",
    'I will report back once the deploy is live.',
    "I'll check back in a few minutes.",
    "Now I'll wait for the build.",
    "I'm waiting on the test run to finish.",
    'Waiting for CI.',
    'The fix is pushed.\n- Watching the release job until it is green.',
    "Let me keep an eye on the workflow and tell you how it goes.",
    "We'll update you as soon as the migration completes.",
    "I'll check back with you once the build is done.",
  ]) assert.equal(claimsWait(text), true, text);
});

test('what the user may do, waiting on the user, and past waiting are not claims', () => {
  for (const text of [
    'You can wait for CI before merging.',
    'Once CI passes, merge it.',
    "I'll wait for your go-ahead before deleting anything.",
    "I'll wait for you to confirm the price.",
    "Waiting on your answer about the colours.",
    'I waited for the build and it passed: 42 tests, 0 failures.',
    'While waiting for the build I fixed the footer.',
    "Done: the header is in and the tests pass. Next I'll add search.",
    "Let me know when you're ready and I'll continue.",
    '',
  ]) assert.equal(claimsWait(text), false, text);
});

test('nothing is out only when both lists are there and empty', () => {
  assert.equal(nothingOut({ background_tasks: [], session_crons: [] }), true);
  assert.equal(nothingOut({ background_tasks: [{ id: 'b1', type: 'shell' }], session_crons: [] }), false);
  assert.equal(nothingOut({ background_tasks: [], session_crons: [{ id: 'c1' }] }), false);
  assert.equal(nothingOut({ background_tasks: [] }), false, 'a missing field is unknown');
  assert.equal(nothingOut({}), false);
  assert.equal(nothingOut(null), false);
});

test('the fact states what is out and gives no order', () => {
  assert.match(WAIT_FACT, /nothing is out that would wake this session/);
  assert.doesNotMatch(WAIT_FACT, /\b(must|should|do not|don't|start a|set up)\b/i);
});
