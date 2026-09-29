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

test('objectiveSection: the whole text, minus fenced code, when there is no OBJECTIVE heading at all', () => {
  const prompt = `x${'y'.repeat(700)}`;
  assert.equal(objectiveSection(prompt), prompt);
  assert.equal(objectiveSection('a\n```\ncode\n```\nb'), 'a\n\nb');
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

test('inferredReviewWord: a negation directly ahead of the word clears it', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\n(not auth)\nCONTEXT\nmore'), null);
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nno payment is involved\nCONTEXT\nmore'), null);
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nNo auth changes in this task\nCONTEXT\nmore'), null);
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nNot a payment feature\nCONTEXT\nmore'), null);
});

test('inferredReviewWord: the same word elsewhere, not negated, still matches', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\ntouches payment; not auth\nCONTEXT\nmore'), 'payment');
});

test('inferredReviewWord: a word outside the OBJECTIVE section is not caught', () => {
  assert.equal(inferredReviewWord('TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nthis touches billing code too'), null);
});

// ---- WHERE / FILES / RULES lines never count -------------------------------

test('objectiveSection: a WHERE line is stripped even inside the OBJECTIVE section', () => {
  const prompt = 'OBJECTIVE\nRename a CSS class\nWHERE: repo x  run dir <absolute path in the main checkout>\nCONTEXT\nmore';
  assert.equal(objectiveSection(prompt).includes('checkout'), false);
});

test('inferredReviewWord: a packet with no OBJECTIVE heading and a WHERE line naming "checkout" is not tagged', () => {
  const prompt = 'TASK: 1\nPROGRESS: x\nBRANCH: task/1\nREPO: C:\\x (worktree copy)\nWHY: fix the lint\nWHERE: repo C:\\x  run dir <absolute path in the main checkout>\nDO:\n1. fix it\nRULES: no secrets\nDONE WHEN: tests pass';
  assert.equal(inferredReviewWord(prompt), null);
});

test('inferredReviewWord: a FILES or RULES line naming a review word is not tagged either', () => {
  assert.equal(inferredReviewWord('TASK: x\nWHY: tidy up\nFILES: src/payment/*.ts\nDO:\n1. rename'), null);
  assert.equal(inferredReviewWord('TASK: x\nWHY: tidy up\nRULES: do not touch auth code\nDO:\n1. rename'), null);
});

test('inferredReviewWord: the same word in the actual objective text still matches', () => {
  const prompt = 'TASK: 1\nWHY: add Stripe payment capture\nWHERE: repo x  run dir in the main checkout\nDO:\n1. build it';
  assert.equal(inferredReviewWord(prompt), 'payment');
});

// ---- a brief with no OBJECTIVE heading (a real run: the ask came after pasted code) ----

const PASTED = 'const members = [];\n'.repeat(40);
const NO_HEADINGS = `Repo: a small club server (clean).\n\nFull current contents:\n\n\`\`\`js\n${PASTED}\`\`\`\n\nTask: add a password check so only people who know the password can see /members.\n\nReport back what you changed.`;

test('objectiveSection: with no heading, a Task line that comes after pasted code is still read', () => {
  assert.ok(NO_HEADINGS.indexOf('Task:') > 600, 'the ask sits past the first 600 characters');
  assert.match(objectiveSection(NO_HEADINGS), /add a password check/);
});

test('inferredReviewWord: a brief with no headings and no task id still names the risky word', () => {
  assert.equal(inferredReviewWord(NO_HEADINGS), 'password');
});

test('inferredReviewWord: with no heading, a risky word only inside pasted code does not count', () => {
  const brief = `Repo: a small site.\n\n\`\`\`js\nconst token = 1;\n${PASTED}\`\`\`\n\nTask: rename a CSS class.`;
  assert.equal(inferredReviewWord(brief), null);
});

test('inferredReviewWord: with no heading, a negation still clears the word', () => {
  assert.equal(inferredReviewWord(`${'Background line.\n'.repeat(60)}Task: tidy the docs; no password changes.`), null);
});
