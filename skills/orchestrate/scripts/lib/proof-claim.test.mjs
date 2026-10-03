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
    // The total after "of" is not a passing count (independent review, round 6).
    ['42 of 44 checks pass; two fail on Windows.', ['42']],
    ['39 of 42 tests pass. Should I skip the 3 Windows ones?', ['39']],
    // A sentence that opens by asking claims nothing; one that states a count
    // and then asks still does (round 7). Nor does the end of a version number.
    ['Do all 42 tests pass on your machine?', []],
    ['All 42 tests pass, so shall I open the PR?', ['42']],
    ['Tests: 42 passed; want me to merge?', ['42']],
    ['v2.0.10 passed the smoke test.', []],
    // "of" with no number before it is not a total (round 7).
    ['A total of 42 tests pass.', ['42']],
    ['3 tests pass', []],
    ['The build took 42 seconds and 12 files changed.', []],
    ['I added 12 tests; they pass.', []],
    ['Fixed 15 bugs.', []],
    ['', []],
  ];
  for (const [text, want] of cases) assert.deepEqual(claimedCounts(text), want, text);
});

test('what the model was shown is evidence, its own words are not, and thousands separators are ignored', () => {
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

const used = (id, name) => rec({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = (id, text) => rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

test('a total across suites printed in one run counts; the host\'s copy of an edit does not', () => {
  // cargo prints one line per crate: 12 and 30 are the 42.
  assert.deepEqual(unseenCounts('All 42 tests pass across the two crates.', [used('b1', 'Bash'), result('b1', 'test result: ok. 12 passed; 0 failed\ntest result: ok. 30 passed; 0 failed')].join('\n')), []);
  // A search result is not a run: five matches of "41 passed" are not 205 (round 7).
  assert.deepEqual(unseenCounts('All 205 tests pass.', [used('g1', 'Grep'), result('g1', 'a: 41 passed\nb: 41 passed\nc: 41 passed\nd: 41 passed\ne: 41 passed')].join('\n')), ['205']);
  // A figure the lead wrote into a file is in the host's record of the edit,
  // not in anything the model was shown, so it proves nothing.
  const edit = rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'The file was updated.' }] }, toolUseResult: { newString: 'All 42 tests pass' } });
  assert.deepEqual(unseenCounts('All 42 tests pass.', edit), ['42']);
  // A helper's hand-back the host queued in is shown to the model, so it counts.
  const queued = rec({ type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification>CI: 1,520 checks passed</task-notification>' } });
  assert.deepEqual(unseenCounts('1,520 checks pass.', queued), []);
});

test('the summary written at compaction and a file\'s line numbers prove nothing (round 7)', () => {
  // The summary is model-written: it restates the lead's own earlier claims.
  const summary = rec({ type: 'user', isCompactSummary: true, message: { content: 'Earlier: all 42 tests pass.' } });
  assert.deepEqual(unseenCounts('All 42 tests pass.', [summary, output('ℹ pass 7')].join('\n')), ['42']);
  // A file read carries a line-number column that would match almost any count.
  assert.deepEqual(unseenCounts('All 42 tests pass.', [used('r1', 'Read'), result('r1', '    41\tconst x = 1;\n    42\tconst y = 2;')].join('\n')), ['42']);
  // The file's own text still counts.
  assert.deepEqual(unseenCounts('All 42 tests pass.', [used('r2', 'Read'), result('r2', '     1\tCI: 42 tests passed on main')].join('\n')), []);
});
