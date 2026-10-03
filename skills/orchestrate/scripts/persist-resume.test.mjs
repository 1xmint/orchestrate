// persist-resume.test.mjs — the router's gate for "continue", "resume" and
// "try again": keep-going is armed only by an open run whose goal is in its
// ledger, whose Done when is written and which has a task not done. Real router
// process, fake HOME, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTER = join(dirname(fileURLToPath(import.meta.url)), 'router.mjs');
const HEAD = ['| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|---|---|'];
const row = (id, phase) => `| ${id} | ${phase} | — | src/x.ts | implementer · sonnet | do ${id} | exit 0 | 0 | — |`;

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5', tierSource: 'user', setAt: '2026-09-08T00:00:00Z' }));
  writeFileSync(join(home, '.claude', 'orchestrate', 'autocompact-default.json'), '{}');
  return home;
}

// A repo with one open run; `rows` are the task rows, `doneWhen` its Done when.
function makeRepo(withRun, { rows = [row('9-8-0001', '🔨 running')], doneWhen = '- `pytest -q` passes' } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (withRun) {
    const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'RUN.md'), [
      '# Run 20260908-tidy-finish', '', '## Goal', '', 'Finish the tidy command so notes stop piling up.', '',
      '## Done when', '', doneWhen, '', '## Tasks', '', ...HEAD, ...rows, '',
      '## Pickup', '', 'Pickup prompt: dispatch 9-8-0002', '', '## Verified vs inherited', '', 'Verified directly: none', '',
    ].join('\n'));
  }
  return repo;
}

function say(home, cwd, text, session = 's1') {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt_id: `p${Math.random()}`, cwd, permission_mode: 'auto', prompt: text }),
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}
const persistOf = (home, session = 's1') => {
  try { return JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', `${session}.json`), 'utf8')).persist || null; } catch { return null; }
};
const armed = (home, session) => Boolean(persistOf(home, session) && persistOf(home, session).armed);

test('resume words arm keep-going on an open run, with the ledger goal', () => {
  for (const w of ['resume', 'continue', 'yes continue', 'continue whenever your ready', 'carry on', 'ok lets resume']) {
    const home = makeHome(); const repo = makeRepo(true);
    const out = say(home, repo, w);
    assert.equal(armed(home), true, w);
    const p = persistOf(home);
    assert.equal(p.goalSource, 'ledger', w);
    assert.match(p.goal, /tidy command/, w);
    assert.match(out, /\[orchestrate · persist\] auto-continue is on toward: "[^"]*tidy command/, w);
  }
});

test('status words and prompts with a new goal or a hold-back never arm', () => {
  for (const w of ['whats left', 'whats left?', 'where are we?', 'continue and add a login page', "no, don't continue"]) {
    const home = makeHome(); const repo = makeRepo(true);
    say(home, repo, w);
    assert.equal(armed(home), false, w);
  }
});

test('a bare "continue" with no run, or when every task is done, or with no Done when, arms nothing', () => {
  let home = makeHome();
  say(home, makeRepo(false), 'continue');
  assert.equal(armed(home), false, 'no run');
  home = makeHome();
  say(home, makeRepo(true, { rows: [row('9-8-0001', '✅ done')] }), 'continue');
  assert.equal(armed(home), false, 'every task done');
  home = makeHome();
  say(home, makeRepo(true, { doneWhen: '<what done looks like>' }), 'continue');
  assert.equal(armed(home), false, 'Done when not filled in');
});

test('"try again" restores keep-going that was on before, and never creates it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  say(home, repo, 'try again');
  assert.equal(armed(home), false, 'nothing was on before');

  say(home, repo, 'keep going until the login page works', 's2');
  assert.equal(armed(home, 's2'), true);
  // The Stop hook ends the loop (here: a step that did no work).
  const sf = join(home, '.claude', 'orchestrate', 'sessions', 's2.json');
  const st = JSON.parse(readFileSync(sf, 'utf8'));
  st.persist = { ...st.persist, armed: false, endedAt: new Date().toISOString(), endReason: 'the last step did no visible work' };
  writeFileSync(sf, JSON.stringify(st));
  assert.equal(armed(home, 's2'), false);
  say(home, repo, 'try again', 's2');
  assert.equal(armed(home, 's2'), true, 'restored');
  assert.match(persistOf(home, 's2').goal, /login page/, 'with the goal it had');
});

test('a resume or a retry while keep-going is on leaves it as it is', () => {
  // A new arming resets the loop's record, and with it the wait's clock and the
  // Monitor it holds for (independent review, round 8).
  const home = makeHome(); const repo = makeRepo(true);
  say(home, repo, 'continue', 's4');
  const first = persistOf(home, 's4');
  assert.equal(first.armed, true);
  for (const again of ['continue', 'ok go ahead', 'try again']) {
    say(home, repo, again, 's4');
    assert.equal(persistOf(home, 's4').armedAt, first.armedAt, again);
  }
});

test('"continue until complete" is never saved as the goal', () => {
  const home = makeHome(); const repo = makeRepo(true);
  say(home, repo, 'continue until complete');
  const p = persistOf(home);
  assert.equal(p.armed, true);
  assert.doesNotMatch(p.goal, /continue until complete/i);
  assert.equal(p.goalSource, 'ledger');

  const home2 = makeHome();
  const out = say(home2, makeRepo(false), 'continue until complete', 's3');
  const p2 = persistOf(home2, 's3');
  assert.equal(p2.goal, '', 'no run, no goal: empty, not the phrase');
  assert.doesNotMatch(out, /toward: ""/, 'an empty goal is never printed as quotes');
  assert.match(out, /no goal is recorded/);
});

test('the Stop decision names the next open item, and stops when every task is done', async () => {
  const { persistDecision } = await import('./persist-check.mjs');
  const { ALL_DONE_TEXT } = await import('./lib/runs.mjs');
  const scan = { progressed: true, denied: false, errors: [], asked: false, goalMet: false };
  const open = persistDecision({ scan, goal: 'g', next: { state: 'open', source: 'task', text: '9-8-0002 do 9-8-0002' } });
  assert.equal(open.kind, 'continue');
  assert.match(open.why, /next open item: 9-8-0002 do 9-8-0002/);
  const done = persistDecision({ scan, goal: 'g', next: { state: 'all-done', source: 'task', text: ALL_DONE_TEXT } });
  assert.equal(done.kind, 'stop');
  assert.equal(done.why, ALL_DONE_TEXT);
});

test('the Stop loop stops after three continues name the same open item, and a new item starts the count again', async () => {
  const { persistDecision } = await import('./persist-check.mjs');
  const scan = { progressed: true, denied: false, errors: [], asked: false, goalMet: false };
  const stuck = { state: 'open', source: 'task', text: '9-8-0002 do 9-8-0002' };
  let rec = {};
  for (let i = 1; i <= 3; i++) {
    const d = persistDecision({ rec, scan, goal: 'g', next: stuck });
    assert.equal(d.kind, 'continue', `continue ${i} on the same item`);
    rec = d.rec;
  }
  const fourth = persistDecision({ rec, scan, goal: 'g', next: stuck });
  assert.equal(fourth.kind, 'stop');
  assert.match(fourth.why, /3 steps in a row ended with the same step still open: 9-8-0002/);
  const moved = persistDecision({ rec, scan, goal: 'g', next: { ...stuck, text: '9-8-0003 next' } });
  assert.equal(moved.kind, 'continue', 'the item changed, so the run is not stuck');
  assert.equal(moved.rec.sameItem, 1);
});
