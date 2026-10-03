// persist-resume.test.mjs — the router's gate for "continue", "resume" and
// "try again": keep-going is armed only by an open run whose goal is in its
// ledger, whose Done when is written and which has a task not done. Real router
// process, fake HOME, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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

test('the run template\'s own lines are no finish line: a run made by run-init and left unfilled does not arm', () => {
  // Whole-file review of the router, 2026-10-03: "Why it matters: <...>",
  // "- <evidence ...>" and the template's fixed "When it ends" line passed as
  // written, and "continue" armed 25 steps toward the template's words.
  const home = makeHome(); const repo = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const init = spawnSync(process.execPath, [join(dirname(ROUTER), 'run-init.mjs'), 'tidy', '--repo', repo, '--goal', 'Finish the tidy command', '--session-id', 's8'], {
    encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home },
  });
  assert.equal(init.status, 0, init.stderr);
  const runsDir = join(repo, '.orchestrator', 'runs');
  const runMd = join(runsDir, readdirSync(runsDir)[0], 'RUN.md');
  // One real task, so only the finish line is missing.
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace(/\| <globs this task owns> \| <role · model> \| <replace this placeholder row> \|/, '| src/** | implementer · sonnet | add the --since flag |'));
  say(home, repo, 'continue', 's8');
  assert.equal(armed(home, 's8'), false, 'no finish line written');
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('- <evidence that would prove it, one line each; a command, a file, a page state>', '- `node --test` passes and `tidy --since 7d` lists only last week\'s notes'));
  say(home, repo, 'continue', 's8');
  assert.equal(armed(home, 's8'), true, 'a written finish line arms it');
  assert.doesNotMatch(persistOf(home, 's8').goal, /</, 'the goal carries none of the template\'s placeholders');
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

function start(home, cwd, source, session = 's1') {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: session, cwd }),
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}
const FULL_CARD = /orchestrate is loaded\. The user owns what the product should do/;

test('a "continue" that turns keep-going on brings the full card and the run page, once', () => {
  // A short word that starts up to 25 unwatched steps gets the guidance a first
  // request would (whole-file review of the router, 2026-10-03).
  const home = makeHome(); const repo = makeRepo(true);
  const first = say(home, repo, 'continue', 's5');
  assert.equal(armed(home, 's5'), true);
  assert.match(first, FULL_CARD);
  assert.match(first, /\[orchestrate · run [^\]]*RUN\.md\]/);
  assert.match(first, /auto-continue is on toward/);
  const again = say(home, repo, 'keep going', 's5');
  assert.doesNotMatch(again, FULL_CARD, 'the card is not sent twice');
  assert.doesNotMatch(again, /\[orchestrate · run /, 'nor the run page');
  assert.doesNotMatch(again, /auto-continue is on toward/, 'nor the keep-going line while nothing changed');
});

test('a resumed session still gets the card on its first real request; a summary does not repeat it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  start(home, repo, 'resume', 's6');
  const out = say(home, repo, 'Add a CSV export button to the reports page and make sure the existing tests still pass', 's6');
  assert.match(out, FULL_CARD, 'a resume prints no card, so it is still owed');
  start(home, repo, 'compact', 's7');
  const after = say(home, repo, 'Add a CSV export button to the reports page and make sure the existing tests still pass', 's7');
  assert.doesNotMatch(after, FULL_CARD, 'a summary carries the card already');
});

test('"persist off" holds for the session and says so when a keep-going ask is held back; "persist on" lifts it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  assert.match(say(home, repo, 'persist off', 's9'), /keep-going is off for this session; "persist on" lets it turn on again/);
  const held = say(home, repo, 'keep going until the login page works', 's9');
  assert.equal(armed(home, 's9'), false);
  assert.match(held, /keep-going is off for this session \(the user said "persist off"\)/);
  assert.match(say(home, repo, 'persist on', 's9'), /keep-going can turn on again/);
  const on = say(home, repo, 'keep going until the login page works', 's9');
  assert.equal(armed(home, 's9'), true);
  assert.doesNotMatch(on, /the user said "persist off"/);
});

test('a prompt the host wrote (source "system") arms nothing and adds nothing', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's10', prompt_id: 'p1', cwd: repo, permission_mode: 'auto', prompt: 'continue', source: 'system' }),
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
  assert.equal(armed(home, 's10'), false);
});

test('an explicit keep-going ask in a new session gets the full card, never the short one beside it', () => {
  // Independent review of the hook-fix batch: "small" did not know the prompt
  // armed keep-going, so the short card ("just do it yourself") went out with
  // the full one.
  const home = makeHome(); const repo = makeRepo(false);
  const out = say(home, repo, 'keep going until the login page works', 's11');
  assert.equal(armed(home, 's11'), true);
  assert.match(out, FULL_CARD);
  assert.doesNotMatch(out, /looks like a small, one-step task/);
});

test('the run page printed at a resume is not printed again with the card', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const resumed = start(home, repo, 'resume', 's12');
  assert.match(resumed, /\[orchestrate · resumed\] run /);
  const out = say(home, repo, 'Add a CSV export button to the reports page and make sure the existing tests still pass', 's12');
  assert.match(out, FULL_CARD);
  assert.doesNotMatch(out, /\[orchestrate · run /, 'the resume already showed it');
});
