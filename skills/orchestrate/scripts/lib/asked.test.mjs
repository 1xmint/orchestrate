// lib/asked.test.mjs — the count of a question the lead put to the user that
// came back unanswered, as pure functions. The router payload test that feeds a
// real transcript is in router.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastQuestion, questionKey, leavesOpen, nextAsked, askedLine } from './asked.mjs';

test('the question is the last sentence, and only when the message ends on one', () => {
  assert.equal(lastQuestion('I built the list. Should the shop owner see deleted orders?'), 'Should the shop owner see deleted orders?');
  assert.equal(lastQuestion('Done.\n\n**Do you want email or SMS for the reminders?**'), 'Do you want email or SMS for the reminders?');
  assert.equal(lastQuestion('Should I use email? I picked email for now.'), null, 'a message that moved on asked nothing');
  assert.equal(lastQuestion(''), null);
  assert.equal(lastQuestion('Search is in. Which list should search use: the title or the full ingredient list?'), 'Which list should search use: the title or the full ingredient list?', 'a colon does not cut the question');
});

test('the same words with other spacing, case, punctuation or numbers are the same question', () => {
  assert.equal(questionKey('Email or SMS for the 3 reminders?'), questionKey('email or  SMS, for the 4 reminders'));
  assert.notEqual(questionKey('Email or SMS?'), questionKey('Email, SMS or both?'), 'a reworded question starts again');
});

test('a nudge or a question back leaves it open; an answer, a yes or "you decide" settles it', () => {
  assert.equal(leavesOpen('continue', { nudge: true }), true);
  assert.equal(leavesOpen('what would you pick?'), true, 'only asking back is not an answer');
  assert.equal(leavesOpen('', {}), true);
  assert.equal(leavesOpen('email please'), false);
  assert.equal(leavesOpen('yes'), false, 'a yes answers a yes-or-no question');
  assert.equal(leavesOpen('you decide', { nudge: true }), false, 'handing the choice back settles it');
  assert.equal(leavesOpen('your call'), false);
  assert.equal(leavesOpen('which would you pick?'), true, 'naming the lead in a question is still asking back');
});

test('the count rises only for the same question left open, and is said from the second time', () => {
  const q = 'Do you want email or SMS for the reminders?';
  const one = nextAsked(null, { question: q, reply: 'continue', nudge: true });
  assert.equal(one.times, 1);
  assert.equal(askedLine(one), '', 'once is not yet a pattern');
  const two = nextAsked(one, { question: q, reply: 'keep going', nudge: true });
  assert.equal(two.times, 2);
  assert.equal(askedLine(two), '[orchestrate · question] This question has gone out 2 times unchanged; the replies were "continue", "keep going": "Do you want email or SMS for the reminders?"');
  assert.equal(nextAsked(two, { question: q, reply: 'email' }), null, 'an answer clears it');
  assert.equal(nextAsked(two, { question: 'Which colour for the button?', reply: 'continue', nudge: true }).times, 1, 'a different question starts at one');
  assert.equal(nextAsked(two, { question: null, reply: 'continue', nudge: true }), null, 'a message with no question clears it');
});

test('the fact states the count and the replies, never what to do', () => {
  const rec = { key: 'k', times: 3, question: 'Email or SMS?', replies: ['continue', 'go on', 'what do you think?'] };
  const line = askedLine(rec);
  assert.match(line, /gone out 3 times unchanged/);
  assert.doesNotMatch(line, /\b(take|pick|decide|choose|must|should)\b/i, 'the card says what to do; the hook only counts');
});
