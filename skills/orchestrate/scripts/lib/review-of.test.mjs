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
