// guard-agent.test.mjs — the review gate a dispatch's own OBJECTIVE can
// trigger, with no REVIEW: yes line at all: the hook process's actual
// dispatch record. The pure functions behind the gate (objectiveSection,
// reviewWordMatch, inferredReviewWord) have their own tests in
// lib/review-words.test.mjs.
//   node --test skills/orchestrate/scripts/guard-agent.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('a prose TASK line ("TASK: build the login page") holds for review under "this task", never the first word', () => {
  const home = sandboxHome();
  const sid = 's-prose-task';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: build the login page\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /REVIEW OF: this task$/);
  assert.doesNotMatch(ctx, /REVIEW OF: build\b/);
});
