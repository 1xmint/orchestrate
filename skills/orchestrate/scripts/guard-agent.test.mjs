// guard-agent.test.mjs — the review gate a dispatch's own OBJECTIVE can
// trigger, with no REVIEW: yes line at all: the pure functions
// (objectiveSection, reviewWordMatch, inferredReviewWord) and the hook
// process's actual dispatch record.
//   node --test skills/orchestrate/scripts/guard-agent.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectiveSection, reviewWordMatch, inferredReviewWord, REVIEW_WORDS } from './guard-agent.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'guard-agent.mjs');

function sandboxHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-guard-agent-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro' }));
  return home;
}

function dispatch(home, sid, ti) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: home, tool_use_id: `u-${Math.random()}`, tool_input: ti }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { stdout: r.stdout, json };
}

function lastDispatch(home, sid) {
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', `${sid}.json`), 'utf8'));
  return state.dispatches[state.dispatches.length - 1];
}

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

// ---- the dispatch record itself --------------------------------------------

test('a dispatch with no REVIEW line but an objective mentioning Stripe payment records review:true and reviewInferred', () => {
  const home = sandboxHome();
  const sid = 's-payment';
  dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  const d = lastDispatch(home, sid);
  assert.equal(d.review, true);
  assert.match(d.reviewInferred, /^(payment|stripe)$/);
});

test('a dispatch whose objective just renames a CSS class records no review', () => {
  const home = sandboxHome();
  const sid = 's-css';
  dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const d = lastDispatch(home, sid);
  assert.equal(d.review, undefined);
  assert.equal(d.reviewInferred, undefined);
});

test('an explicit REVIEW: yes still sets review:true with no reviewInferred word', () => {
  const home = sandboxHome();
  const sid = 's-explicit';
  dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nREVIEW: yes\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const d = lastDispatch(home, sid);
  assert.equal(d.review, true);
  assert.equal(d.reviewInferred, undefined);
});

test('an inferred review adds a plain-language additionalContext note naming the word and how to dispatch a reviewer', () => {
  const home = sandboxHome();
  const sid = 's-note';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-1-0099\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /will wait for an independent review because its objective mentions payment/);
  assert.match(ctx, /dispatch orch-reviewer on opus with REVIEW OF: 9-1-0099/);
});

test('an explicit REVIEW: yes dispatch gets no duplicate inferred-review sentence', () => {
  const home = sandboxHome();
  const sid = 's-no-dup';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-1-0099\nREVIEW: yes\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.doesNotMatch(ctx, /will wait for an independent review/);
});
