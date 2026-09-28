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

// ---- the solo/helper pair (round-9 audit Part C item 3, area 2) -----------

test('the first orch-implementer dispatch of a session with no run ledger open carries both figures', () => {
  const home = sandboxHome();
  const sid = 's-pair-first';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /price tag: orch-implementer on sonnet ≈ \$1\.50/);
  assert.match(ctx, /≈ \$0\.60 done in this chat \(measured ratio over five live rounds\)/);
});

test('a second orch-implementer dispatch in the same session gets today\'s tag only', () => {
  const home = sandboxHome();
  const sid = 's-pair-second';
  dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: y\nOBJECTIVE\nRename another CSS class\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /price tag: orch-implementer on sonnet ≈ \$1\.50/);
  assert.doesNotMatch(ctx, /done in this chat/);
});

test('a dispatch with no REVIEW-triggering context but a role other than orch-implementer gets today\'s tag only', () => {
  const home = sandboxHome();
  const sid = 's-pair-role';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-researcher', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRead a file\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /price tag: orch-researcher on sonnet/);
  assert.doesNotMatch(ctx, /done in this chat/);
});

test('the first orch-implementer dispatch of a session bound to an open run ledger gets today\'s tag only', () => {
  const home = sandboxHome();
  const dir = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runDir = join(dir, '.orchestrator', 'runs', '20260910-open');
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, '# Run\n\n## Budget\n\nCeiling: $50 at list price · sessions: ~1 · set 2026-09-10\n\n## Tasks\n\n| id | phase | role · model | task | acceptance | attempts | result |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 📋 planned | i · sonnet | do it | ev | 0 | — |\n');
  const sessDir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessDir, { recursive: true });
  const sid = 'ledger1';
  writeFileSync(join(sessDir, `${sid}.json`), JSON.stringify({ v: 1, session_id: sid, run: { root: dir, runId: '20260910-open', runMd, boundAt: new Date().toISOString(), explicit: true } }));

  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: dir, tool_use_id: 'u-ledger', tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' } }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  const json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /price tag: orch-implementer on sonnet/);
  assert.doesNotMatch(ctx, /done in this chat/);
});
