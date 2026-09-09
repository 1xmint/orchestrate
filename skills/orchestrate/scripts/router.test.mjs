// router.test.mjs — the emission policy, proven on fixture prompts.
//   node --test "skills/orchestrate/scripts/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTER = join(HERE, 'router.mjs');

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5', tierSource: 'user', setAt: '2026-09-08T00:00:00Z' }));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  for (const n of ['orch-planner', 'orch-implementer', 'orch-researcher', 'orch-browser', 'orch-reviewer', 'orch-debugger']) {
    writeFileSync(join(home, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\n---\n`);
  }
  return home;
}

function makeRepo(withRun) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (withRun) {
    const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'RUN.md'), [
      '# Run 20260908-tidy-finish', '', '## Goal', 'finish tidy', '', '## Tasks', '',
      '| id | phase | role · model | task | rubric (written before dispatch) | attempts | evidence |',
      '|---|---|---|---|---|---|---|',
      '| 9-8-0001 | 🔨 running | implementer · sonnet | add --since | test passes | 1 | — |', '',
      '## Pickup', '', 'Pickup prompt: dispatch 9-8-0002 once 0001 lands', 'Pickup confidence: high', 'Resume risk: mild', '',
      '## Verified vs inherited', '', 'Verified directly: none', '',
    ].join('\n'));
  }
  return repo;
}

function run(home, payload) {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  const out = r.stdout.trim();
  if (!out) return '';
  const j = JSON.parse(out);
  return j.hookSpecificOutput.additionalContext;
}

function prompt(home, cwd, text, extra = {}) {
  return run(home, { hook_event_name: 'UserPromptSubmit', session_id: extra.session_id || 'sess-a', prompt_id: extra.prompt_id || `p${Math.random()}`, cwd, permission_mode: 'auto', prompt: text, ...extra });
}

test('first substantive prompt gets the card once; a one-line fix gets no rung line', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, "Fix the typo in README.md: 'recieve' → 'receive'.");
  assert.match(out, /^\[orch-router · once per session\] you: unknown model · tier max5 · orch-agents 6\/6 · open run: none in this repo · limits today: none/);
  assert.match(out, /cheapest rung/);
  assert.doesNotMatch(out, /\n\[orch-router\] /, 'no hint for an inline fix');
  assert.ok(out.length < 2200, `card too long: ${out.length} chars`);
  const again = prompt(home, repo, 'Fix the second typo in README.md too.');
  assert.equal(again, '', 'silent on a later inline prompt');
});

test('non-substantive prompts are silent and do not spend the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  assert.equal(prompt(home, repo, 'yes'), '');
  assert.equal(prompt(home, repo, '/usage'), '');
  const trace = ['this happens on tidy', 'Traceback (most recent call last):']
    .concat(Array.from({ length: 30 }, (_, i) => `  File "notelocus/tidy.py", line ${i + 10}, in <module>`)).join('\n');
  assert.equal(prompt(home, repo, trace), '', 'paste guard');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sess-a.json'), 'utf8'));
  assert.equal(state.cardSent, false);
});

test('a multi-part goal with tests and review hints /orchestrate with tier models', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Add a --since <date> flag to notelocus tidy, with a test that proves older notes stay put, then run the CI checks and get the data-safety rule reviewed.');
  assert.match(out, /\[orch-router\] multi-step: .*→ \/orchestrate; max5: orch-implementer sonnet, orch-reviewer opus/);
});

test('release pipeline: multi-step, asks one question before the risky step; "GitHub Actions workflow" is not the workflow lane', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Set up the release pipeline: add a GitHub Actions workflow that runs the gate, tag v0.4.0 after it passes, and publish the .skill as a release asset.');
  assert.match(out, /multi-step: .*\/orchestrate/);
  assert.match(out, /one question with a recommendation before the "release" step/);
});

test('a research question routes to sources, not memory', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, "What's the currently recommended way to read a .env file in Node 22 without a dependency? Cite the source.");
  assert.match(out, /\[orch-router\] research: .*fetch the primary source inline.*orch-researcher sonnet.*Not from memory/);
});

test('a lookup is a script job', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Which files call find_repo_root and how many call sites are there across the workspace?');
  assert.match(out, /\[orch-router\] script: .*rg \| head.*Explore\(haiku\) only past ~3 files/);
});

test('research-decide-migrate gets plan mode first and /orchestrate', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Research whether the ledger should move from Markdown to SQLite, decide, and if yes migrate the existing runs with a script and tests.');
  assert.match(out, /multi-step: .*\/orchestrate/);
  assert.match(out, /plan mode first/);
});

test('waiting phrases point at Monitor even for a small task', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'Fix the typo in README.md please, it is on line 3.');
  const out = prompt(home, repo, 'wait for CI on the PR to go green, then merge it');
  assert.match(out, /wait with Monitor \/ ScheduleWakeup \/ CronCreate \/ \/loop, not a sleep loop/);
});

test('one mechanical change per unit is /batch', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Rename filed_at to filed_on in every module and open a PR per package');
  assert.match(out, /\[orch-router\] batch: .*\/batch \(user-typed\)/);
});

test('same prompt_id twice is emitted once (double registration)', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const a = prompt(home, repo, 'Add X with tests, then run the gate and review it', { prompt_id: 'fixed-1' });
  assert.match(a, /\/orchestrate/);
  const b = prompt(home, repo, 'Add X with tests, then run the gate and review it', { prompt_id: 'fixed-1' });
  assert.equal(b, '');
});

test('cooldown: the same hint does not repeat within five prompts; the cap holds', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const text = 'Add X with tests, then run the gate and review it';
  const first = prompt(home, repo, text);
  assert.match(first, /\/orchestrate/);
  const second = prompt(home, repo, text);
  assert.equal(second, '', 'cooldown suppresses the repeat');
});

test('an open run: the card names it and resume words hint the resume path; SessionStart resume injects the Pickup', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const out = prompt(home, repo, 'continue the tidy run where we left off', { session_id: 'sess-b' });
  assert.match(out, /open run: 20260908-tidy-finish/);
  assert.match(out, /\[orch-router\] resume: open run 20260908-tidy-finish \+ resume words → \/orchestrate resume: read RUN.md once, continue from Pickup \("dispatch 9-8-0002 once 0001 lands"\), do not re-plan/);
  const resumed = run(home, { hook_event_name: 'SessionStart', source: 'resume', session_id: 'sess-c', cwd: repo });
  assert.match(resumed, /\[orch-router · resumed\] open run .*RUN\.md — Pickup: "dispatch 9-8-0002 once 0001 lands" \(confidence high, risk mild\) · tier max5/);
  const compacted = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 'sess-c', cwd: repo });
  assert.match(compacted, /compacted\]/);
  assert.match(compacted, /\nladder: context → inline/);
  const startup = run(home, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-d', cwd: repo });
  assert.equal(startup, '');
});

test('"router off" mutes the session; "router on" restores it; clear resets the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  assert.equal(prompt(home, repo, 'router off'), '');
  assert.equal(prompt(home, repo, 'Add X with tests, then run the gate and review it'), '');
  assert.equal(prompt(home, repo, 'router on'), '');
  assert.match(prompt(home, repo, 'Add X with tests, then run the gate and review it'), /once per session/);
  run(home, { hook_event_name: 'SessionStart', source: 'clear', session_id: 'sess-a', cwd: repo });
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions', 'sess-a.json')), false);
});

test('the card carries no spend total; a family limit in the transcript moves the reviewer down', () => {
  const home = makeHome(); const repo = makeRepo(false);
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro', tierSource: 'user' }));
  const transcript = join(repo, 't.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: "You've hit your Opus limit until 14:00" }] } }) + '\n');
  const out = prompt(home, repo, 'Add X with tests, then run the gate and review it', { transcript_path: transcript });
  // A running total reads as an allowance and invites spending it. The tier is
  // what the manager reasons from; measure.mjs reports what a finished run cost.
  assert.doesNotMatch(out, /fable \d|\bcap\b|opt-in/i);
  assert.match(out, /tier pro/);
  assert.match(out, /limits today: opus/);
  assert.match(out, /orch-reviewer sonnet/);
});

test('malformed or missing input never fails', () => {
  const home = makeHome();
  for (const input of ['', '{', '{"hook_event_name":"UserPromptSubmit"}', '{"hook_event_name":"Other","prompt":"x"}']) {
    const r = spawnSync(process.execPath, [ROUTER], { input, encoding: 'utf8', windowsHide: true, env: { ...process.env, USERPROFILE: home, HOME: home } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  }
});

test('--explain reports features without writing state', () => {
  const home = makeHome();
  const r = spawnSync(process.execPath, [ROUTER, '--explain', 'Add X with tests, then run the gate and review it'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, USERPROFILE: home, HOME: home } });
  const j = JSON.parse(r.stdout);
  assert.equal(j.rung, 6.5);
  assert.equal(j.features.heads, 3);
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions')), false);
});

// A transcript tail whose last assistant record names the manager's own model.
function transcriptOn(model, effort) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-tr-'));
  const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', effort, message: { model, usage: { input_tokens: 5 } } }),
  ].join('\n') + '\n');
  return p;
}

test('discussing an idea is rung 1: the router stays silent', () => {
  const home = makeHome(); const repo = makeRepo(false);
  // The card is spent on the first substantive prompt, so open with one that
  // earns it, then ask the two shapes of "what do you think".
  prompt(home, repo, 'Fix the typo in README.md.');
  assert.equal(prompt(home, repo, 'What do you think of this idea: one ledger file per run instead of a folder?'), '');
  assert.equal(prompt(home, repo, 'Do you think moving the ledger to SQLite is a good idea? I keep going back and forth on it, because the Markdown file is readable by a human and by an agent, but it is not queryable, and the runs are starting to pile up in a way that makes me want to ask questions across them rather than read them one at a time.'), '');
  assert.equal(prompt(home, repo, 'thoughts on the router card length?'), '');
});

test('the manager knows its own model: above the author it reviews the diff itself', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'Add a --since flag to the tidy command with a test that proves older notes stay put.', { transcript_path: transcriptOn('claude-opus-5', 'high') });
  assert.match(out, /you: opus @ high effort/, 'the state line names the manager');
  assert.match(out, /review the diff yourself \(opus over sonnet/);
});

test('at or below the author, or on a risky change, a reviewer is dispatched', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const asSonnet = prompt(home, repo, 'Add a --since flag to the tidy command with a test that proves older notes stay put.', { transcript_path: transcriptOn('claude-sonnet-5', 'high') });
  assert.match(asSonnet, /you: sonnet/);
  assert.match(asSonnet, /orch-reviewer opus/);
  assert.doesNotMatch(asSonnet, /review the diff yourself/);

  const home2 = makeHome(); const repo2 = makeRepo(false);
  const risky = prompt(home2, repo2, 'Add the release step and publish it to production, with a test.', { transcript_path: transcriptOn('claude-opus-5', 'high') });
  assert.match(risky, /orch-reviewer/);
  assert.doesNotMatch(risky, /review the diff yourself/, 'a risky change always gets an independent reviewer');
});

// Importing router.mjs used to hang: its main block read stdin at load time, so
// every test here had to spawn a child. It is guarded now, which is what makes
// the next three tests possible at all.
import { managerAdvice, MANAGER_SETUP } from './router.mjs';

test('the manager is told its own setup is wrong, once, and only when it is', () => {
  // The user picks the conversation's model and effort before the skill exists,
  // so this is the one setting the skill cannot fix for them.
  assert.match(managerAdvice('max5', { model: 'opus', effort: 'medium' }), /high effort rather than medium/);
  assert.match(managerAdvice('max5', { model: 'sonnet', effort: 'low' }), /opus rather than sonnet and high effort rather than low/);
  assert.match(managerAdvice('pro', { model: 'opus', effort: 'high' }), /sonnet rather than opus/);
  assert.equal(managerAdvice('max5', { model: 'opus', effort: 'high' }), '', 'silence when it is already right');
  assert.equal(managerAdvice('max20', { model: 'opus', effort: 'high' }), '');
});

test('it never nags about an unknown model, and calls out only real overkill', () => {
  assert.equal(managerAdvice('max5', null), '', 'cannot tell, so says nothing');
  assert.equal(managerAdvice('max5', { model: 'opus' }), '', 'no effort reported, no effort advice');
  assert.equal(managerAdvice('unknown', { model: 'sonnet', effort: 'low' }), '', 'no tier, no recommendation');
  // xhigh is one step up and left alone; max is two and is the worker profile.
  assert.equal(managerAdvice('max5', { model: 'opus', effort: 'xhigh' }), '');
  assert.match(managerAdvice('max5', { model: 'opus', effort: 'max' }), /worker profile/);
});

test('every tier has a manager setup, and none of them is Fable', () => {
  for (const [tier, want] of Object.entries(MANAGER_SETUP)) {
    assert.ok(want.model && want.effort, tier);
    assert.notEqual(want.model, 'fable', `${tier}: Fable is the deep single-shot role, never the manager`);
    assert.equal(want.effort, 'high', `${tier}: high everywhere; depth is spent on the dispatched roles`);
  }
});

test('the advice reaches the user with the card, and does not repeat', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const transcript = join(repo, 'ts.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5' } }) + '\n');
  const first = prompt(home, repo, 'Add a --since flag with a test, then run the gate and review it.', { transcript_path: transcript });
  assert.match(first, /\[orch-router · your setup\] on max5, a manager belongs on high effort/);
  const second = prompt(home, repo, 'Add another flag with a test, then run the gate and review it.', { transcript_path: transcript });
  assert.doesNotMatch(second, /your setup/, 'said once, with the card, and not again');
});
