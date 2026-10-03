// lib/persist-intent.test.mjs — the resume, retry and status words, and the
// armed line when no goal is known. Pure functions only; the router's own
// arming gate is in persist-resume.test.mjs. Namespace import so a missing
// export fails each test on its own instead of the whole file at load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pw from './persist-words.mjs';

test('status words are status, with or without the question mark', () => {
  for (const s of ['whats left', "what's left", 'whats left?', 'where are we?', 'status']) {
    assert.equal(pw.promptIntent(s), 'status', s);
  }
});

test('resume words are a resume when short and without a new goal or a hold-back', () => {
  for (const s of ['resume', 'continue', 'yes continue', 'continue whenever your ready', 'carry on', 'ok lets resume', 'pick up', 'go on', 'keep going', 'lets resume', 'proceed', 'ok proceed', 'yes, go ahead', 'go ahead with the plan']) {
    assert.equal(pw.promptIntent(s), 'resume', s);
  }
});

test('"go ahead" and "proceed" approve, and so answer the question asked; "continue" only nudges', () => {
  for (const s of ['go ahead', 'yes, go ahead', 'ok proceed', 'proceed with the plan']) assert.equal(pw.approves(s), true, s);
  for (const s of ['continue', 'yes continue', 'go ahead?', 'go ahead and push to main']) assert.equal(pw.approves(s), false, s);
});

test('try again is a retry, not a resume', () => {
  assert.equal(pw.promptIntent('try again'), 'retry');
  assert.equal(pw.promptIntent('please try again'), 'retry');
});

test('a new goal, a hold-back word or a long prompt is no resume or retry', () => {
  for (const s of ['continue and add a login page', "no, don't continue", 'do not continue', 'stop, then continue later', 'wait, continue', 'hold on, try again',
    'continue with the thing we talked about yesterday when you have time ok thanks', 'fix it and try again', 'go ahead and add a login page', "don't proceed yet", '', '   ', null,
    // Found by the independent review, round 8: a question, a hold-back, a
    // sentence about something else, or "go ahead and" a new step.
    'go ahead?', 'why did you go ahead without asking?', 'never go ahead without asking me', 'not yet, explain first then proceed',
    'before you proceed, explain the plan', "it won't proceed past the login screen", 'I will go ahead and test it myself', 'go ahead and push to main']) {
    assert.equal(pw.promptIntent(s), null, String(s));
  }
});

test('an ordinary prompt has no intent', () => {
  assert.equal(pw.promptIntent('rename foo to bar'), null);
  assert.equal(pw.promptIntent('how does the router work'), null);
});

test('"continue until complete" names no goal; a prompt with real words does', () => {
  for (const s of ['continue until complete', 'keep going until done', 'ok keep going', 'carry on until it is finished']) {
    assert.equal(pw.barePersistPhrase(s), true, s);
  }
  for (const s of ['keep going until the login page works', 'finish the checkout flow']) {
    assert.equal(pw.barePersistPhrase(s), false, s);
  }
});

test('an armed line with no goal says so instead of quoting an empty goal', () => {
  for (const goal of ['', '   ', undefined, null]) {
    const line = pw.persistLine({ armed: true, goal });
    assert.doesNotMatch(line, /toward: ""/, JSON.stringify(goal));
    assert.match(line, /no goal/i, JSON.stringify(goal));
    assert.match(line, /persist off/, 'the way out is still named');
  }
  assert.match(pw.persistLine({ armed: true, goal: 'ship it' }), /toward: "ship it"/);
});
