// lib/proof-claim.test.mjs — which test counts a closing message claims, and
// whether the session's record shows them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedCounts, evidenceText, unseenCounts } from './proof-claim.mjs';

const rec = r => JSON.stringify(r);
const said = text => rec({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const output = text => rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } });

test('a count of passing tests or checks is a claim; other numbers are not', () => {
  const cases = [
    ['All 42 tests pass.', ['42']],
    ['1,244/1,244 tests pass on Node 18, 20 and 22.', ['1244']],
    ['Tests: 37 passed, 0 failed.', ['37']],
    ['npm test: 120 passing', ['120']],
    ['All 12 unit tests now pass and the page loads.', ['12']],
    ['42 of 44 checks pass; two fail on Windows.', ['42', '44']],
    ['3 tests pass', []],
    ['The build took 42 seconds and 12 files changed.', []],
    ['I added 12 tests; they pass.', []],
    ['Fixed 15 bugs.', []],
    ['', []],
  ];
  for (const [text, want] of cases) assert.deepEqual(claimedCounts(text), want, text);
});

test('anything but the assistant\'s own words is evidence, with thousands separators ignored', () => {
  const tail = [said('All 42 tests pass.'), output('ℹ tests 1,244\nℹ pass 1,244\nℹ fail 0')].join('\n');
  const ev = evidenceText(tail);
  assert.match(ev, /pass 1244/);
  assert.doesNotMatch(ev, /42 tests pass/, 'the assistant\'s text is not evidence');
});

test('a count the record shows passes; one it does not is reported', () => {
  const tail = [output('ℹ tests 37\nℹ pass 36\nℹ fail 1'), said('Done.')].join('\n');
  assert.deepEqual(unseenCounts('All 42 tests pass.', tail), ['42']);
  assert.deepEqual(unseenCounts('36 tests pass, 1 fails.', tail), []);
  // A helper's report, a notification or the user's own words count too.
  const helper = rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'STATUS: DONE\nEVIDENCE: pytest -q -> 41 passed' }] }] } });
  assert.deepEqual(unseenCounts('41 tests pass.', helper), []);
  const note = rec({ type: 'user', message: { role: 'user', content: '<task-notification>CI: 1,520 checks passed</task-notification>' } });
  assert.deepEqual(unseenCounts('1,520 checks pass.', note), []);
  // A number inside a longer one is not the same number.
  assert.deepEqual(unseenCounts('All 42 tests pass.', output('took 1420 ms; 4.2 s total')), ['42']);
  // No claim, nothing to report.
  assert.deepEqual(unseenCounts('The header is in.', ''), []);
});
