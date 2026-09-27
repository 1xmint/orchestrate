// lib/review-words.test.mjs — the pure functions that decide whether a
// packet's own OBJECTIVE makes it wait for independent review, with no
// REVIEW: yes line at all: objectiveSection, reviewWordMatch, inferredReviewWord.
//   node --test skills/orchestrate/scripts/lib/review-words.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectiveSection, reviewWordMatch, inferredReviewWord, REVIEW_WORDS } from './review-words.mjs';

// ---- objectiveSection ------------------------------------------------------

test('objectiveSection: the text between OBJECTIVE and the next heading', () => {
  const prompt = 'TASK: 1\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nsome context here';
  assert.equal(objectiveSection(prompt).trim(), 'Add Stripe payment capture');
});

test('objectiveSection: runs to the end of the prompt when no closing heading follows', () => {
  const prompt = 'OBJECTIVE\nRename a CSS class';
  assert.equal(objectiveSection(prompt).trim(), 'Rename a CSS class');
});

test('objectiveSection: the first 600 characters when there is no OBJECTIVE heading at all', () => {
  const prompt = `x${'y'.repeat(700)}`;
  assert.equal(objectiveSection(prompt), prompt.slice(0, 600));
});

test('objectiveSection: stops at SCOPE or DONE WHEN too, not only CONTEXT', () => {
  assert.equal(objectiveSection('OBJECTIVE\nDrop the old index\nSCOPE\nmore').trim(), 'Drop the old index');
  assert.equal(objectiveSection('OBJECTIVE\nDrop the old index\nDONE WHEN\nmore').trim(), 'Drop the old index');
});

// ---- reviewWordMatch / inferredReviewWord ----------------------------------

test('reviewWordMatch: matches every word in the list as a whole word or phrase', () => {
  for (const word of REVIEW_WORDS) {
    assert.equal(reviewWordMatch(`some text with ${word} in it`), word, `did not match "${word}"`);
  }
});

test('reviewWordMatch: a substring that is not a whole word does not match', () => {
  assert.equal(reviewWordMatch('this is a pricingless sentence about authors'), null);
});

test('inferredReviewWord: a Stripe-payment objective is caught, a CSS rename is not', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore'), 'payment');
  assert.equal(inferredReviewWord('OBJECTIVE\nRename a CSS class'), null);
});

test('inferredReviewWord: a negation still matches, on purpose', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nNo auth changes in this task\nCONTEXT\nmore'), 'auth');
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nNot a payment feature\nCONTEXT\nmore'), 'payment');
});

test('inferredReviewWord: a word outside the OBJECTIVE section is not caught', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nthis touches billing code too'), null);
});
