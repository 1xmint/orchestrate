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

import { asksForPastedContents, leadTextWithRetry, plainRole, missingFact, estimateWording, sizeRatio, sizePhrase, dollarsShown } from './guard-agent.mjs';

test('missingFact says what a building brief lacks as one line, in a fixed order', () => {
  assert.equal(missingFact('orch-implementer', 'TASK: 1\nfind it', false), 'brief lacks: what it is for, a check it is done, a PROGRESS path');
  assert.equal(missingFact('orch-implementer', 'FOR: a person ships a flag\nPROGRESS: /r/p.md', false), 'brief lacks: a check it is done');
  assert.equal(missingFact('orch-debugger', 'FOR: x\nDONE WHEN\n- test passes', false), 'brief lacks: a PROGRESS path');
  assert.equal(missingFact('orch-implementer', 'FOR: x\nDONE WHEN (evidence)\n- t\nPROGRESS: /r/p.md', false), '');
});

test('missingFact is no longer than the PROGRESS sentence it replaces, and silent where that was', () => {
  const worst = missingFact('orch-implementer', 'TASK: 1', false);
  assert.ok(Buffer.byteLength(worst) <= Buffer.byteLength('no PROGRESS line: a capped return will have nothing to resume from'));
  assert.equal(missingFact('orch-implementer', 'TASK: 1', true), '', 'plan mode');
  assert.equal(missingFact('orch-reviewer', 'TASK: 1', false), '');
  assert.equal(missingFact('orch-researcher', 'TASK: 1', false), '');
});

test('missingFact reads fields from a packet file the prompt points at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-missing-'));
  const p = join(dir, 'packet.md');
  writeFileSync(p, 'FOR: a person\nDONE WHEN\n- ok\nPROGRESS: /r/p.md\n');
  assert.equal(missingFact('orch-implementer', `Your packet is the file ${p}. Follow it.`, false), '');
});

test('estimateWording says an estimate, before the work, for this helper, and never as a price tag', () => {
  const tag = 'price tag: orch-implementer on sonnet ≈ $1.50 at list price, not subscription usage (reasoned 2026-09-09, not yet measured here)';
  const out = estimateWording(tag);
  assert.match(out, /^estimate before work, this helper: orch-implementer on sonnet ≈ \$1\.50 at list price/);
  assert.doesNotMatch(out, /price tag|cost/);
  assert.ok(Buffer.byteLength(out) <= Buffer.byteLength(tag));
  const unpriced = 'price tag: r on s — no figure yet, measured or reasoned';
  assert.equal(estimateWording(unpriced), unpriced, 'a tag with no figure is left alone');
});

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'guard-agent.mjs');

function sandboxHome(tier = 'pro') {
  const home = mkdtempSync(join(tmpdir(), 'orch-guard-agent-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: tier }));
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

test('a dispatch note names the helper by what it does, never by role id', () => {
  const home = sandboxHome();
  const { stdout } = dispatch(home, 's-plain', { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-1-0100\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  assert.match(stdout, /helper size: a builder on sonnet/);
  assert.doesNotMatch(stdout, /orch-(implementer|reviewer)/);
  assert.equal(plainRole('orch-debugger'), 'a fault-finder');
  assert.equal(plainRole('orchestrate:orch-planner'), 'a planner');
});

test('an inferred review adds a plain-language additionalContext note naming the word and how to dispatch a reviewer', () => {
  const home = sandboxHome();
  const sid = 's-note';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-1-0099\nOBJECTIVE\nAdd Stripe payment capture\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /will wait for an independent review because its objective mentions payment/);
  assert.match(ctx, /send a reviewer on opus with REVIEW OF: 9-1-0099/);
});

test('a reviewer dispatch is never itself flagged for review, whatever its brief mentions', () => {
  const home = sandboxHome();
  const sid = 's-reviewer';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-reviewer', model: 'opus', prompt: 'TASK: 9-1-0100\nREVIEW OF: 9-1-0099\nOBJECTIVE\nCheck the Stripe payment capture\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.doesNotMatch(ctx, /will wait for an independent review/);
  const d = lastDispatch(home, sid);
  assert.equal(d.review, undefined);
  assert.equal(d.reviewInferred, undefined);
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
  const home = sandboxHome('api');
  const sid = 's-pair-first';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /estimate before work, this helper: orch-implementer on sonnet ≈ \$1\.50/);
  assert.match(ctx, /≈ \$0\.60 done in this chat \(measured ratio over five live rounds\)/);
});

test('a second orch-implementer dispatch in the same session gets today\'s tag only', () => {
  const home = sandboxHome('api');
  const sid = 's-pair-second';
  dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: y\nOBJECTIVE\nRename another CSS class\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /estimate before work, this helper: orch-implementer on sonnet ≈ \$1\.50/);
  assert.doesNotMatch(ctx, /done in this chat/);
});

test('a dispatch with no REVIEW-triggering context but a role other than orch-implementer gets today\'s tag only', () => {
  const home = sandboxHome('api');
  const sid = 's-pair-role';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-researcher', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRead a file\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /estimate before work, this helper: orch-researcher on sonnet/);
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
  assert.match(ctx, /estimate before work, this helper: orch-implementer on sonnet/);
  assert.doesNotMatch(ctx, /done in this chat/);
});

test('on a subscription the first implementer dispatch is told its size against a solo build, with no dollar sign', () => {
  const { json } = dispatch(sandboxHome('pro'), 's-pair-sub', { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRename a CSS class\nCONTEXT\nmore' });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /helper size: a builder on sonnet, about the usual size for this kind of helper; a solo build in this chat is about 1\/2\.6 of it/);
  assert.doesNotMatch(ctx, /\$/);
});

test('size is a ratio to the usual model of the role: a costlier model reads as larger, the usual one as usual, an unknown one as nothing', () => {
  assert.equal(sizePhrase(sizeRatio('orch-implementer', 'opus', [])), 'about 2.7x the usual size for this kind of helper');
  assert.equal(sizePhrase(sizeRatio('orch-implementer', 'sonnet', [])), 'about the usual size for this kind of helper');
  assert.equal(sizeRatio('orch-implementer', '', []), null);
});

test('a dollar figure is shown only with a ceiling set or pay-per-use billing', () => {
  assert.equal(dollarsShown({ budget: { ceiling: 5 } }), true);
  assert.equal(dollarsShown({ budget: { ceiling: null } }), false);
  assert.equal(dollarsShown(null), false);
});

// ---- the first helper of a session brings three plain lines ----------------

function dispatchWithTranscript(home, sid, ti, lines) {
  const tp = join(mkdtempSync(join(tmpdir(), 'orch-guard-tr-')), 't.jsonl');
  writeFileSync(tp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: home, transcript_path: tp, tool_use_id: `u-${Math.random()}`, tool_input: ti }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return (json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext) || '';
}
const userPrompt = { type: 'user', message: { role: 'user', content: 'build it' } };
const leadSaid = text => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Agent', input: {} }] } };
const PKT = { subagent_type: 'orch-researcher', model: 'sonnet', prompt: 'TASK: x\nOBJECTIVE\nRead a file\nCONTEXT\nmore' };

function dispatchFull(home, sid, ti, lines) {
  const tp = join(mkdtempSync(join(tmpdir(), 'orch-guard-tr-')), 't.jsonl');
  writeFileSync(tp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: home, transcript_path: tp, tool_use_id: `u-${Math.random()}`, tool_input: ti }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  try { return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : {}; } catch { return {}; }
}

test('first helper: a lead message naming no model is refused once, with the three lines owed; sent again it goes through', () => {
  const home = sandboxHome();
  const first = dispatchFull(home, 's-fh-a', PKT, [userPrompt, leadSaid('I will have a builder do it in a separate copy, then commit.'), toolUse]);
  assert.equal(first.permissionDecision, 'deny');
  assert.match(first.permissionDecisionReason, /the user is owed three short lines before the first helper starts: what the job needs, who does it on what model and why, and how it is checked/);
  assert.doesNotMatch(first.permissionDecisionReason, /unchanged/);
  const again = dispatchFull(home, 's-fh-a', PKT, [userPrompt, leadSaid('Here are the three lines: Sonnet builds it, and I test it.'), toolUse]);
  assert.notEqual(again.permissionDecision, 'deny');
  const later = dispatchFull(home, 's-fh-a', { ...PKT, prompt: `${PKT.prompt} again` }, [userPrompt, leadSaid('one more'), toolUse]);
  assert.notEqual(later.permissionDecision, 'deny');
});

test('first helper: helpers sent together are all refused while no model is named, up to three, then never', () => {
  const home = sandboxHome();
  const t = [userPrompt, leadSaid('Working on it.'), toolUse];
  for (let i = 0; i < 3; i++) {
    assert.equal(dispatchFull(home, 's-fh-e', { ...PKT, prompt: `${PKT.prompt} ${i}` }, t).permissionDecision, 'deny', `helper ${i} is refused`);
  }
  assert.notEqual(dispatchFull(home, 's-fh-e', { ...PKT, prompt: `${PKT.prompt} 4` }, t).permissionDecision, 'deny', 'the fourth goes through');
  assert.notEqual(dispatchFull(home, 's-fh-e', { ...PKT, prompt: `${PKT.prompt} 5` }, t).permissionDecision, 'deny');
});

test('first helper: once a message names a model, no later helper is refused', () => {
  const home = sandboxHome();
  assert.equal(dispatchFull(home, 's-fh-g', PKT, [userPrompt, leadSaid('Working on it.'), toolUse]).permissionDecision, 'deny');
  assert.notEqual(dispatchFull(home, 's-fh-g', PKT, [userPrompt, leadSaid('Sonnet builds it.'), toolUse]).permissionDecision, 'deny');
  assert.notEqual(dispatchFull(home, 's-fh-g', { ...PKT, prompt: `${PKT.prompt} x` }, [userPrompt, leadSaid('Nothing more.'), toolUse]).permissionDecision, 'deny');
});

test('first helper: a lead message that names a model is not refused', () => {
  const o = dispatchFull(sandboxHome(), 's-fh-f', PKT, [userPrompt, leadSaid('A helper on Sonnet builds it.'), toolUse]);
  assert.notEqual(o.permissionDecision, 'deny');
});

test('first helper: nothing said when the lead message names a model and a check', () => {
  const ctx = dispatchWithTranscript(sandboxHome(), 's-fh-b', PKT, [userPrompt, leadSaid('The job needs a search. A helper on Sonnet builds it because it is routine. I check it by running the tests.'), toolUse]);
  assert.doesNotMatch(ctx, /first helper this session/);
});

test('first helper: an older turn\'s message is not mistaken for this turn\'s; the plain fact is sent', () => {
  const ctx = dispatchWithTranscript(sandboxHome(), 's-fh-c', PKT, [leadSaid('Sonnet builds it and I test it.'), userPrompt, toolUse]);
  assert.match(ctx, /first helper this session: the user is owed three plain lines first: what the job needs, who does it on what model and why, and how it is checked/);
});

test('first helper: with no transcript at all the plain fact is sent, and the dispatch is not refused', () => {
  const { json } = dispatch(sandboxHome(), 's-fh-d', PKT);
  assert.equal(json.hookSpecificOutput.permissionDecision, undefined);
  assert.match(json.hookSpecificOutput.additionalContext, /first helper this session: the user is owed three plain lines first/);
});

// ---- a brief with no task id and no headings (a real run: a password check) ----

const NO_HEADINGS_BRIEF = `Repo: a small club server (clean).\n\nFull current contents:\n\n\`\`\`js\n${'const members = [];\n'.repeat(40)}\`\`\`\n\nTask: add a password check so only people who know the password can see /members.\n\nReport back what you changed.`;

test('a brief with no task id and no headings still gets the review note and is recorded as risky work', () => {
  const home = sandboxHome();
  const sid = 's-no-headings';
  const { json } = dispatch(home, sid, { subagent_type: 'orch-implementer', model: 'sonnet', prompt: NO_HEADINGS_BRIEF });
  const ctx = json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext || '';
  assert.match(ctx, /will wait for an independent review because its objective mentions password/);
  const d = lastDispatch(home, sid);
  assert.equal(d.review, true);
  assert.equal(d.reviewInferred, 'password');
  assert.equal(d.task, null);
});

test('the lead message is read again when it has not reached the transcript yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'g-retry-'));
  const f = join(dir, 't.jsonl');
  const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'do it' } });
  const lead = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Plan: sonnet builds it, tests check it.' }] } });
  writeFileSync(f, user + '\n');
  let sleeps = 0;
  const text = leadTextWithRetry(f, { sleep: () => { if (++sleeps === 2) writeFileSync(f, user + '\n' + lead + '\n'); } });
  assert.match(text, /sonnet builds it/);
  assert.equal(sleeps, 2);
  writeFileSync(f, user + '\n');
  let n = 0;
  assert.equal(leadTextWithRetry(f, { tries: 3, sleep: () => { n++; } }), null);
  assert.equal(n, 2);
});

test('a brief that asks for pasted contents gets a note to ask for a file path; one that does not, none', () => {
  const home = sandboxHome();
  const a = dispatch(home, 's-paste', { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'TASK: 9-1-0101\nOBJECTIVE\nList the settings\nRETURN: paste the full output of the run' });
  assert.match(a.stdout, /the hand-back is five lines, so ask for a file path instead/);
  const b = dispatch(home, 's-nopaste', { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'TASK: 9-1-0102\nOBJECTIVE\nList the settings\nRETURN: five lines and a file path' });
  assert.doesNotMatch(b.stdout, /hand-back is five lines/);
  assert.equal(asksForPastedContents('report back the file'), true);
  assert.equal(asksForPastedContents('the pasted server code is below'), false);
});
