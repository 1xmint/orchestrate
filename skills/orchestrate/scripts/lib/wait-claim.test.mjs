// lib/wait-claim.test.mjs — which closing messages promise that this session
// will wait or check back, and when the Stop payload says nothing is out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsWait, nothingOut, WAIT_FACT, SCHEDULING_TOOL } from './wait-claim.mjs';

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
    "I'll check back with you once the build is done.",
    'Will check back in a few minutes.',
    "I'll report back with the results.",
    "I'll follow up when the build finishes.",
    'Standing by for CI.',
    "I'll let you know if CI fails.",
    "I'll keep an eye on CI for you and report back.",
    "Pushed; I'll report back when CI is green.\n\nSummary: added the footer.",
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
    // Found by the independent review (round 5): each was refused once.
    "Let me know when the deploy is done and I'll check again.",
    "- Added a file watcher: on startup we'll watch the config directory for changes.",
    'Fixed: waiting for the DB no longer hangs the CLI.',
    "Tell me which branch to use; I'll wait.",
    "I'll wait for further instructions.",
    "I scheduled a reminder with send_later; I'll check back on CI in 20 minutes.",
    "We'll poll the server every 5 seconds in the new client.",
    "I'll check back once you've merged the PR.",
    // A promise early in a long message is not the closing one.
    "I'll check back on CI later.\n\nThe header is in.\n\nThe footer is in.\n\nSearch is in.",
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

test('the fact says only what the payload shows, and gives no order', () => {
  assert.match(WAIT_FACT, /^the Stop payload lists no helper, background command, Monitor or scheduled prompt/);
  // A reminder sent into the conversation from outside is not in the lists,
  // so the fact predicts nothing about what happens next.
  assert.doesNotMatch(WAIT_FACT, /until|idle|nothing will/i);
  assert.doesNotMatch(WAIT_FACT, /\b(must|should|do not|don't|start a|set up)\b/i);
});

test('a scheduling tool is recognised by name', () => {
  for (const n of ['mcp__claude-code-remote__send_later', 'ScheduleWakeup', 'CronCreate', 'mcp__claude-code-remote__create_trigger']) assert.ok(SCHEDULING_TOOL.test(n), n);
  for (const n of ['Bash', 'Edit', 'Agent', 'Monitor', 'Read']) assert.ok(!SCHEDULING_TOOL.test(n), n);
});
