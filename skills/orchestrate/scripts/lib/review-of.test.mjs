import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewOfIn } from './review-of.mjs';

test('a brief and a hand-back naming the same work read the same id', () => {
  assert.equal(reviewOfIn('Look at this.\nREVIEW OF: tu-x.\n'), 'tu-x');
  assert.equal(reviewOfIn('OUTCOME: PASS (REVIEW OF: tu-x) fine.\n', { handBack: true }), 'tu-x');
});

test('a brief only counts REVIEW OF at the start of a line', () => {
  assert.equal(reviewOfIn('OUTCOME: PASS (REVIEW OF: tu-x)\n'), null);
  assert.equal(reviewOfIn('as the last REVIEW OF: tu-x said'), null);
});

// Review of d8724f9: every way a hand-back that is not a verdict could still
// name reviewed work. Each must read null.
test('a hand-back names reviewed work only from an opening PASS or FAIL line', () => {
  const hb = t => reviewOfIn(t, { handBack: true });
  assert.equal(hb('OUTCOME: DONE fixed\n  OUTCOME: PASS (REVIEW OF: 9-1-0001) ok\n'), null, 'an indented quoted verdict after DONE');
  assert.equal(hb('OUTCOME: DONE fixed\nNOTES:\nOUTCOME: FAIL (REVIEW OF: 9-1-0001) was the review\n'), null, 'a bare quoted verdict after DONE');
  assert.equal(hb('The review said:\n    OUTCOME: FAIL (REVIEW OF: X) q\n'), null, 'a quoted verdict under prose');
  assert.equal(hb('OUTCOME: DONE fixed\nreview of: the auth flow\n'), null, 'a lowercase own line in a builder hand-back');
  assert.equal(hb('PASS src/x.test.js\nREVIEW OF: X\n'), null, 'test-runner output is not a verdict');
  assert.equal(hb('OUTCOME: PASS (REVIEW OF: tu-y) ok\nFULL REPORT: below\nREVIEW OF: tu-x\n'), 'tu-y', 'the opening line wins over the report');
  assert.equal(hb('TASK: 9-1-0002\nREVIEW OF: 9-1-0001\nVERDICT: PASS\n'), '9-1-0001', 'the older form still reads beside a VERDICT line');
});
