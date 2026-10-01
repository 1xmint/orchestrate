// first-helper-gate.test.mjs — the first writing helper of a session waits for
// .orchestrator/PROJECT.md to have a filled Next step (guard-agent.mjs
// firstHelperGate), and the hook says so with its own prefix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'guard-agent.mjs');
const FILLED = '## What this is for\n\nNotes.\n\n## Next\n\n1. Add search → a box on the notes page that finds a note\n';
const BLANKS = readFileSync(join(HERE, '..', 'assets', 'PROJECT.md'), 'utf8');

function home() {
  const h = mkdtempSync(join(tmpdir(), 'orch-fhg-home-'));
  mkdirSync(join(h, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(h, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro' }));
  return h;
}
function repo(page) {
  const r = mkdtempSync(join(tmpdir(), 'orch-fhg-'));
  spawnSync('git', ['init', '-q', r], { encoding: 'utf8' });
  if (page != null) { mkdirSync(join(r, '.orchestrator'), { recursive: true }); writeFileSync(join(r, '.orchestrator', 'PROJECT.md'), page); }
  return r;
}
function seed(h, sid, agent) {
  writeFileSync(join(h, '.claude', 'orchestrate', 'sessions', `${sid}.json`), JSON.stringify({ v: 1, session_id: sid, dispatches: [{ agent, at: new Date().toISOString() }] }));
}
const BRIEF = 'TASK: x\nFOR: y\nDONE WHEN\n- z\nPROGRESS: /r/p.md';
function hook(h, cwd, sid, type, toolUse = `u-${Math.random()}`) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd, tool_use_id: toolUse, tool_input: { subagent_type: type, model: 'sonnet', prompt: BRIEF } }),
    encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h, ANTHROPIC_API_KEY: '' },
  });
  let j = null; try { j = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  const o = j && j.hookSpecificOutput;
  return { denied: !!o && o.permissionDecision === 'deny', reason: (o && o.permissionDecisionReason) || '' };
}

test('a first writing dispatch with no page is held, naming the file and the command', () => {
  const h = home();
  const a = hook(h, repo(null), 's1', 'orch-implementer');
  assert.equal(a.denied, true);
  assert.match(a.reason, /^orchestrate project: /);
  assert.match(a.reason, /PROJECT\.md is missing/);
  assert.match(a.reason, /project\.mjs" init /);
  assert.match(a.reason, /fill Next/);
  // A 0.18.0 release-check reply told the user "the helper system refused to
  // run anything until a plan existed on file". Routine set-up is not news.
  assert.match(a.reason, /routine set-up, not news for the user/);
});

test('a page whose Next is still blanks holds it too; a filled Next lets it through', () => {
  const h = home();
  assert.match(hook(h, repo(BLANKS), 's2', 'general-purpose').reason, /no filled step under Next/);
  assert.equal(hook(h, repo(FILLED), 's3', 'orch-implementer').denied, false);
});

test('a read-only role is never held, and does not use the check up', () => {
  const h = home();
  const r = repo(null);
  for (const role of ['Explore', 'orch-researcher', 'orch-advisor', 'orch-planner', 'orch-reviewer', 'orch-browser', 'claude-code-guide', 'Plan']) {
    // Other rules (a model rule for the advisor, say) may still apply; only this one is under test.
    assert.doesNotMatch(hook(h, r, `s4-${role}`, role).reason, /^orchestrate project:/, role);
  }
  seed(h, 's5', 'Explore');
  assert.equal(hook(h, r, 's5', 'orch-implementer').denied, true, 'a builder sent after only an Explore is still held');
});

test('an earlier writing dispatch in the session means the check was already met', () => {
  const h = home();
  seed(h, 's6', 'orch-implementer');
  assert.equal(hook(h, repo(null), 's6', 'orch-debugger').denied, false);
});

test('outside a repo nothing is held', () => {
  const h = home();
  assert.equal(hook(h, mkdtempSync(join(tmpdir(), 'orch-nogit-')), 's7', 'orch-implementer').denied, false);
});

test('a repeat of the same held call is held again', () => {
  const h = home();
  const r = repo(null);
  assert.equal(hook(h, r, 's8', 'orch-implementer', 'u-same').denied, true);
  assert.equal(hook(h, r, 's8', 'orch-implementer', 'u-same').denied, true);
});
