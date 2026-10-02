// lib/resume.test.mjs — the resume/checkpoint excerpts and the "does this
// prompt mean carry on?" check, tested directly against the pure functions
// rather than through a spawned router process (router.test.mjs keeps those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RESUME_CAP, resumeExcerpt, sectionExcerpt, CONTINUE_WORD, continueIntent, handoffLine,
} from './resume.mjs';

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

test('lib/resume.mjs exports exactly the ten names this concern owns', async () => {
  const mod = await import('./resume.mjs');
  assert.deepEqual(Object.keys(mod).sort(), [
    'RESUME_CAP', 'boundaryCut', 'sectionExcerpt', 'resumeExcerpt', 'checkpointExcerpt',
    'latestCheckpointFor', 'handoffLine', 'continueIntent', 'CONTINUE_WORD', 'NEW_GOAL_VERB',
  ].sort());
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

test('a bullet crossing the cap is cut at the line boundary before it, never mid-word (bug: was a raw character cut)', () => {
  const repo = makeRepo(true);
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');
  // A "not doing" bullet long enough that RESUME_CAP lands inside one of its
  // words, the shape observed live: the run card came back truncated at
  // "not doing: rewriting SKILL.md body wholesale in wave..." mid-word.
  const bullet = `- not doing: rewriting SKILL.md body wholesale in wave two, since that would blow the token budget for this one task and leave nothing for the ${'x'.repeat(2000)} rest`;
  const runMdText = readFileSync(runMd, 'utf8').replace(
    '- constraint: the never-delete rule holds',
    `- constraint: the never-delete rule holds\n${bullet}`,
  );
  writeFileSync(runMd, runMdText);

  // Reproduce first: the old raw cut landed inside a run of "x"s (mid-word).
  const rawCut = runMdText
    .split('## Constraints and non-goals\n\n')[1].split('\n\n## Approach')[0]
    .split('\n').filter(l => l.trim()).join('\n');
  const budget = RESUME_CAP - 3;
  // Sanity: the raw slice used to land inside a word (a run of "x"s), which is
  // exactly the bug — confirms this fixture reproduces it before the fix is
  // trusted to have changed anything.
  assert.match(rawCut.slice(budget - 5, budget + 5), /xxxxxxxxxx/, 'fixture must actually cross mid-word under a raw cut');

  const ex = resumeExcerpt(runMd);
  assert.ok(ex.length <= RESUME_CAP, `${ex.length} <= ${RESUME_CAP}`);
  assert.match(ex, /\.\.\.$/);
  // The excerpt must end at a full line (the bullet before the giant one), not
  // mid-word inside the run of "x"s.
  assert.doesNotMatch(ex, /x{2,}\.\.\.$/);
  assert.match(ex, /rule holds\.\.\.$/, `expected the cut to fall back to the previous bullet's line boundary, got: ${JSON.stringify(ex.slice(-60))}`);
});

test('sectionExcerpt cuts at a sentence boundary, never mid-word', () => {
  const body = 'The approach keeps changes small. Not doing: rewriting SKILL.md body wholesale in wave two, since that would blow the budget for this task entirely.';
  const md = `## Approach\n\n${body}\n`;
  const wordStart = body.indexOf('wholesale');
  const cap = wordStart + 5 + 3; // lands mid-word under the old raw cut ("whol|esale")
  const rawCut = body.slice(0, cap - 3);
  assert.match(rawCut, /whole$/, 'fixture must cross mid-word under a raw cut');

  const ex = sectionExcerpt(md, ['Approach'], cap);
  assert.ok(ex.length <= cap, `${ex.length} <= ${cap}`);
  assert.match(ex, /\.\.\.$/);
  // Falls back to the last sentence boundary before the cap: "...small."
  assert.equal(ex, 'Approach: The approach keeps changes small....');
});

test('CONTINUE_WORD matches only the whole trimmed prompt', () => {
  for (const w of ['continue', 'keep going', 'resume', 'pick up where we left off', 'where were we', "what's next", 'whats next', 'carry on', 'CONTINUE', ' Resume ']) {
    assert.ok(CONTINUE_WORD.test(w.trim()), w);
  }
  assert.equal(CONTINUE_WORD.test('continue adding tests'), false);
  assert.equal(CONTINUE_WORD.test('should I continue'), false);
});

test('continueIntent: "carry on" without naming a new goal, with or without punctuation', () => {
  const trueCases = [
    'continue',
    'where were we?',
    'continue.',
    "what's next?",
    'go on',
    'pick up',
    'status',
    'what were we doing',
    'where are we?',
    "what's left?",
    'how far did we get?',
    'continue with the migration',
  ];
  for (const t of trueCases) assert.equal(continueIntent(t), true, t);
});

test('continueIntent: false the moment the prompt names a new goal', () => {
  const falseCases = [
    'continue and add a login page',
    'fix the tests',
    'build a new dashboard',
    'add a --json flag',
    'make it faster',
    'create a report',
    'write tests for this',
    'implement the login flow',
    'change the config',
    'remove old code',
  ];
  for (const t of falseCases) assert.equal(continueIntent(t), false, t);
});

test('handoffLine names a written Pickup section over plain git status', () => {
  const runMd = join(mkdtempSync(join(tmpdir(), 'orch-run-')), 'RUN.md');
  writeFileSync(runMd, '## Pickup\n\nPickup prompt: dispatch the next task\nPickup confidence: high\n');
  const ctx = { run: { runMd } };
  const line = handoffLine({ goal: 'ship the login page', lastSeen: new Date(Date.now() - 60000).toISOString() }, ctx);
  assert.match(line, /Pickup section of/);
  assert.doesNotMatch(line, /git status/);
});

test('handoffLine falls back to git status when there is no run or checkpoint', () => {
  const line = handoffLine({ goal: 'ship the login page', session_id: 'no-such-session', lastSeen: new Date(Date.now() - 60000).toISOString() }, { run: null });
  assert.match(line, /run `git status`/);
});
