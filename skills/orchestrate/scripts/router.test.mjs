// router.test.mjs — what the context provider says, and the much larger set of
// things it no longer says.
//   node --test "skills/orchestrate/scripts/**/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardBody, CARD_CAP, resumeExcerpt, RESUME_CAP, readyPhrase, ungradedPhrase } from './router.mjs';

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

function makeRepo(withRun, opts = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (withRun) {
    const dir = join(repo, '.orchestrator', 'runs', opts.runId || '20260908-tidy-finish');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'RUN.md'), [
      `# Run ${opts.runId || '20260908-tidy-finish'}`, '',
      '## Goal', '', 'Finish the tidy command so notes stop piling up.', '',
      'Why it matters: the user files notes by hand today.', '',
      '## Done when', '', '- `pytest -q` passes and no note is lost', '',
      '## Constraints and non-goals', '', '- constraint: the never-delete rule holds', '',
      '## Approach', '', 'Current approach: add --since, then widen it.', 'Next deliverable: the flag with its test.', '',
      '## Tasks', '',
      // Old seven-column table on purpose, unless a test asks for the newer one.
      // Runs written before the dependency columns existed are on people's
      // disks and have to keep working.
      ...(opts.rows || [
        '| id | phase | role · model | task | acceptance evidence | attempts | result |',
        '|---|---|---|---|---|---|---|',
        '| 9-8-0001 | 🔨 running | implementer · sonnet | add --since | test passes | 1 | — |',
      ]), '',
      '## Decisions', '', '- 2026-09-08 — file dates, not git dates — the repo has no history for them', '',
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

test('the first substantive prompt gets the state line and the card, once', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, /\[orchestrate\]/);
  assert.match(first, /tier max5/);
  assert.match(first, /orch-agents 6\/6/);
  assert.match(first, /run: none/);
  assert.match(first, /orchestrate is loaded/);

  const second = prompt(home, repo, 'now do the same for the list command and test that too');
  assert.equal(second, '', 'nothing changed, so there is nothing to say');
});

test('the wording of a message never produces an instruction', () => {
  // Every one of these used to trigger a rung line naming an agent, a research
  // depth, a reviewer or a permission request. A pattern in the wording is not
  // evidence about the work.
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'set up the project so it builds', { session_id: 's-quiet' });
  const messages = [
    'add a --json flag, write the tests, then get it reviewed before we deploy',
    'what is the currently recommended way to read a .env file in node 22',
    'is it a good idea to move the ledger to sqlite',
    'rename the config field in every package and open a PR for each',
    'how many files import the client module',
    'wait until CI goes green and then tell me',
    'research the options, decide an approach, then migrate the schema',
    'is there a recommended model and effort for each subscription tier',
    'fix the auth bug in session.ts, client.ts, router.ts, api.ts, db.ts and web.ts',
  ];
  for (const m of messages) {
    const out = prompt(home, repo, m, { session_id: 's-quiet' });
    assert.equal(out, '', `the router stayed out of it: ${m}`);
  }
});

test('nothing shipped in the router names an agent, a rung or a model to use', () => {
  const src = readFileSync(ROUTER, 'utf8');
  const live = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(live, /orch-implementer|orch-reviewer|orch-researcher|orch-planner|orch-debugger/);
  assert.doesNotMatch(live, /rung|classify|hintFor|MANAGER_SETUP|managerAdvice|reviewClause/);
  // The regular-expression table that read every message is gone with them.
  assert.doesNotMatch(live, /const RX = \{/);
});

test('non-substantive prompts are silent and do not spend the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  for (const t of ['/orchestrate', 'ok', '```\ncode\n```']) {
    assert.equal(prompt(home, repo, t, { session_id: 's-nonsub' }), '');
  }
  assert.match(prompt(home, repo, 'add the flag and test it properly', { session_id: 's-nonsub' }), /orchestrate is loaded/);
});

test('the same prompt_id twice is emitted once (double registration)', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const p = { session_id: 's-dup', prompt_id: 'p-1' };
  assert.match(prompt(home, repo, 'add a --json flag to status and test it', p), /orchestrate is loaded/);
  assert.equal(prompt(home, repo, 'add a --json flag to status and test it', p), '');
});

test('a state change is worth a line; a change of wording is not', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-state' });
  assert.equal(prompt(home, repo, 'and one for list as well please', { session_id: 's-state' }), '');
  // A family limit hit mid-session is a fact the model cannot see.
  const tr = join(repo, 't.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: "You've hit your Opus limit" }] } }));
  const after = prompt(home, repo, 'carry on with the list command now', { session_id: 's-state', transcript_path: tr });
  assert.match(after, /\[orchestrate · changed\]/);
  assert.match(after, /limits today: opus/);
});

test('an open run is named, and its goal comes with it', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const first = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-run' });
  assert.match(first, /run: 20260908-tidy-finish/);
  assert.match(first, /Goal: Finish the tidy command/);
  assert.match(first, /Pickup: Pickup prompt: dispatch 9-8-0002/);
  // The task rows are not re-injected: they are long, mostly finished, and on
  // disk. What a session needs back is the goal it lost.
  assert.doesNotMatch(first, /9-8-0001/);
});

test('resume and compaction carry the goal, the constraints and the Pickup', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const out = run(home, { hook_event_name: 'SessionStart', source: 'resume', session_id: 's-res', cwd: repo });
  assert.match(out, /\[orchestrate · resumed\]/);
  assert.ok(out.includes(join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md')), 'the full path, so it can be opened');
  assert.match(out, /Goal: Finish the tidy command/);
  assert.match(out, /Done when: - `pytest -q` passes/);
  assert.match(out, /Constraints and non-goals:/);
  assert.match(out, /Decisions: - 2026-09-08 — file dates/);
  assert.match(out, /Pickup: Pickup prompt: dispatch 9-8-0002/);

  const compacted = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-res2', cwd: repo });
  assert.match(compacted, /\[orchestrate · compacted\]/);
  assert.match(compacted, /Goal: Finish the tidy command/);
});

test('the resume excerpt is bounded', () => {
  const repo = makeRepo(true);
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');
  const long = readFileSync(runMd, 'utf8').replace('Finish the tidy command so notes stop piling up.', 'x '.repeat(5000));
  writeFileSync(runMd, long);
  const ex = resumeExcerpt(runMd);
  assert.ok(ex.length <= RESUME_CAP, `${ex.length} <= ${RESUME_CAP}`);
  assert.match(ex, /\.\.\.$/);
});

test('a single unambiguous open run binds itself; two do not', () => {
  const home = makeHome(); const repo = makeRepo(true);
  prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-bind' });
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-bind.json'), 'utf8'));
  assert.equal(state.run.runId, '20260908-tidy-finish', 'a hook that writes now has an association');

  const second = join(repo, '.orchestrator', 'runs', '20260909-other');
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  const out = prompt(home, repo, 'start on the second piece of work now please', { session_id: 's-bind2' });
  assert.match(out, /2 candidates/);
  const s2 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-bind2.json'), 'utf8'));
  assert.equal(s2.run, undefined, 'ambiguous means unbound, not a guess');
});

test('a session outside any repo is offered the run, never bound to it', () => {
  const home = makeHome(); const repo = makeRepo(true);
  writeFileSync(join(home, '.claude', 'orchestrate', 'active-run.json'), JSON.stringify({
    v: 1, root: repo, runMd: join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md'), at: new Date().toISOString(),
  }));
  const outside = mkdtempSync(join(tmpdir(), 'orch-outside-'));
  const out = prompt(home, outside, 'pick up where we left off on the tidy work', { session_id: 's-outside' });
  assert.match(out, /none bound; one candidate/);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-outside.json'), 'utf8'));
  assert.equal(state.run, undefined);
});

test('"router off" mutes the session; "router on" restores it; clear resets the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'router off', { session_id: 's-mute' });
  assert.equal(prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-mute' }), '');
  prompt(home, repo, 'router on', { session_id: 's-mute' });
  assert.match(prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-mute' }), /orchestrate is loaded/);

  run(home, { hook_event_name: 'SessionStart', source: 'clear', session_id: 's-mute', cwd: repo });
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions', 's-mute.json')), false);
});

test('the card carries no running total and no advice about the session settings', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const tr = join(repo, 't.jsonl');
  // A session on the "wrong" model and effort. The router used to tell it so.
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [] }, effort: 'low', entrypoint: 'claude-desktop' }));
  const out = prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-card', transcript_path: tr });
  assert.match(out, /you: sonnet @ low effort/, 'it still reports what it can see');
  assert.doesNotMatch(out, /your setup|belongs on|\/model|Effort → High/, 'and offers no opinion about it');
  assert.doesNotMatch(out, /\$\d|spent|total/);
});

test('malformed or missing input never fails', () => {
  const home = makeHome();
  for (const p of [{}, { hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'Nope', prompt: 'x' }]) {
    assert.equal(run(home, p), '');
  }
  const r = spawnSync(process.execPath, [ROUTER], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0);
});

test('--state prints what it would inject and writes nothing', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const r = spawnSync(process.execPath, [ROUTER, '--state'], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[orchestrate\]/);
  assert.match(r.stdout, /card: \d+ characters/);
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions', 'cli.json')), false);
});

test('the card body stays inside the cap it names', () => {
  // Every character is paid on every later turn of the session that got it.
  const body = cardBody();
  assert.ok(body.length <= CARD_CAP, `card is ${body.length} characters, cap ${CARD_CAP}`);
  // It comes from ladder.md, so the text has one home.
  const ladder = readFileSync(join(HERE, '..', 'references', 'ladder.md'), 'utf8');
  assert.ok(ladder.includes(body), 'the card is the fenced block in ladder.md, verbatim');
  assert.match(body, /router off/, 'it says how to turn itself off');
});

// ---- which task is ready ----------------------------------------------------
// A lead was watched waiting on one agent with a finished plan on the board and
// a `/goal` loop running, which is no progress and quota burning at once. It
// could not tell a ready task from a blocked one because the ledger had no
// column for the dependency. Now it does, and the router says so.

const NEW_HEADER = [
  '| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |',
  '|---|---|---|---|---|---|---|---|---|',
];
const taskRow = (id, phase, blocks = '—') =>
  `| ${id} | ${phase} | ${blocks} | src/${id}.ts | implementer · sonnet | do ${id} | exit 0 | 0 | — |`;

test('the run line names the tasks that could start right now', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned'),
    taskRow('9-8-0003', '📋 planned', '9-8-0001'),
  ] });
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-ready' });
  assert.match(out, /ready now: 9-8-0002/);
  assert.doesNotMatch(out, /9-8-0003/, 'a task whose blocker is still running is not ready');
});

test('a legacy ledger says nothing about readiness rather than guessing', () => {
  const home = makeHome();
  const repo = makeRepo(true);
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-legacy' });
  assert.match(out, /run: 20260908-tidy-finish/);
  assert.doesNotMatch(out, /ready now/, 'the old table has no edges to read');
});

test('a run with nothing planned says nothing about readiness', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [...NEW_HEADER, taskRow('9-8-0001', '🔨 running')] });
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-none' });
  assert.doesNotMatch(out, /ready now/);
});

test('a task becoming ready reprints the line; an unchanged board stays quiet', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned', '9-8-0001'),
  ] });
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');

  const first = prompt(home, repo, 'start on the tidy work please', { session_id: 's-change' });
  assert.doesNotMatch(first, /ready now/, 'nothing is ready while the blocker runs');
  assert.equal(prompt(home, repo, 'and how is that going now', { session_id: 's-change' }), '',
    'nothing changed, so nothing is said');

  // The blocker lands. That is the moment the lead has something better to do
  // than wait, and the moment the line is worth its tokens.
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'anything else worth starting yet', { session_id: 's-change' });
  assert.match(after, /\[orchestrate · changed\]/);
  assert.match(after, /ready now: 9-8-0002/);

  assert.equal(prompt(home, repo, 'right, carrying on with that then', { session_id: 's-change' }), '',
    'and it says it once, not every turn');
});

test('a long ready list is trimmed rather than filling the line', () => {
  const ready = Array.from({ length: 9 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = readyPhrase({ ready });
  assert.match(phrase, /ready now: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+5 more/);
  assert.ok(phrase.length < 80, `${phrase.length} characters is small enough to print every turn`);
  assert.equal(readyPhrase({ ready: [] }), '');
  assert.equal(readyPhrase(null), '');
});

test('the run line says what came back and is still waiting on you', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned'),
  ] });
  const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-8-0001', agent: 'orch-implementer', status: 'DONE' })}\n`);

  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-owed' });
  assert.match(out, /1 return to grade: 9-8-0001/, 'singular reads as English');
  assert.match(out, /ready now: 9-8-0002/, 'both facts fit on the one line');
});

test('setting the row stops the reminder, and that counts as a state change', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [...NEW_HEADER, taskRow('9-8-0001', '🔨 running')] });
  const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
  const runMd = join(dir, 'RUN.md');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-8-0001', status: 'DONE' })}\n`);

  assert.match(prompt(home, repo, 'pick the tidy work back up please', { session_id: 's-owed2' }), /1 return to grade/);
  assert.equal(prompt(home, repo, 'anything moved since then', { session_id: 's-owed2' }), '', 'still owed, still silent');

  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'right, what is outstanding now', { session_id: 's-owed2' });
  assert.match(after, /\[orchestrate · changed\]/);
  assert.doesNotMatch(after, /to grade/, 'it has been judged, so it stops asking');
});

test('a long list of owed returns is trimmed like the ready one', () => {
  const ungraded = Array.from({ length: 7 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = ungradedPhrase({ ungraded });
  assert.match(phrase, /7 returns to grade: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+3 more/);
  assert.equal(ungradedPhrase({ ungraded: [] }), '');
  assert.equal(ungradedPhrase(null), '');
});
