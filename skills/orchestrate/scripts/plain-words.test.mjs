// plain-words.test.mjs — every line this plugin shows the user directly is in
// the user's words (plan 0010 step 2d). The person reading is an adult who has
// not learned engineering words, so these lines carry no role name, no machine
// path, and no term of art the plan's glossary spells another way ("helper",
// not subagent; "keep-going", not auto-continue; "summary", not compaction;
// "usage limit", not quota; "save point", not checkpoint).
//
// The lines are produced by the code that prints them, not copied here, so a
// reworded line is checked as it now reads:
//   - keep-going's stop line (persist-check.mjs, a systemMessage), for every
//     reason the loop can stop;
//   - the band (lib/band-line.mjs) and the pause record's text it shows;
//   - the status line footer (statusline.mjs).
// What the lead reads (hook facts, refusals) is not here: it is written for a
// model and may name what the model needs.
//
// The machinery list is the eval's own, read from a grader file, so the two
// cannot drift; the terms and paths are added to it here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistDecision, endMessage } from './persist-check.mjs';
import { bandLine, WAITING_TEXT } from './lib/band-line.mjs';
import { pauseRecord } from './lib/pause.mjs';
import { footer } from './statusline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const grader = readFileSync(join(ROOT, 'evals', 'explain-flow', 'graders', 'no-machinery.md'), 'utf8');
const MACHINERY = new RegExp(/^pattern:\s*'(.*)'\s*$/m.exec(grader)[1]);
const TERMS = /\b(subagents?|dispatch(es|ed)?|compact(ion|ed|s)?|auto-?continue[ds]?|persist(ed|ing)?|quota|harness|transcripts?|tokens?|ctx|done-when|checkpoints?)\b/i;
const PATH = /(^|[\s("'`])(~[\\/]|\/(home|Users|tmp|var|root|mnt|etc)\/|[A-Za-z]:[\\/])/;

function check(label, line) {
  assert.ok(line && line.trim(), `${label}: produced no line`);
  assert.doesNotMatch(line, MACHINERY, `${label}: machinery in "${line}"`);
  assert.doesNotMatch(line, TERMS, `${label}: a term of art in "${line}"`);
  assert.doesNotMatch(line, PATH, `${label}: a machine path in "${line}"`);
}

const scan = (over = {}) => ({ progressed: true, denied: false, quotaRefused: false, errors: [], asked: false, goalMet: false, tools: 1, lastChange: null, ...over });
const stopLine = dec => {
  assert.equal(dec.kind, 'stop', `expected a stop, got ${dec.kind}`);
  return endMessage(dec.say || dec.why);
};

test('every keep-going stop line is in plain words', () => {
  const lines = {
    'still near the size limit after a summary': persistDecision({ scan: scan(), contextAdvice: { action: 'investigate' }, contextReading: { tokens: 150000, session: 'sess-1', compactions: 1 } }),
    'back at the size limit after several summaries': persistDecision({ scan: scan(), contextAdvice: { action: 'compact', fresh: true }, contextReading: { tokens: 150000, session: 'sess-1', compactions: 3 } }),
    'a helper refused': persistDecision({ scan: scan({ denied: true }) }),
    'the same error twice': persistDecision({ rec: { errors: ['Error: the build failed'] }, scan: scan({ errors: ['Error: the build failed'] }) }),
    // A refusal from the plugin's own checks, as errorKey keeps it.
    'the same refusal twice': persistDecision({ rec: { errors: ['orchestrate model: implementer on opus before a cheaper attempt at task #-#-#'] }, scan: scan({ errors: ['orchestrate model: implementer on opus before a cheaper attempt at task #-#-#'] }) }),
    // An open item as a run's task table gives it, ledger id first.
    'the same task still open': persistDecision({ rec: { lastItem: '9-8-0002 add the --since flag', sameItem: 3 }, scan: scan(), next: { state: 'open', source: 'task', text: '9-8-0002 add the --since flag' } }),
    'a question': persistDecision({ scan: scan({ asked: true }) }),
    'goal met': persistDecision({ scan: scan({ goalMet: true }) }),
    'every step marked done': persistDecision({ scan: scan(), next: { state: 'all-done', source: 'task', text: 'x' } }),
    'the same step still open': persistDecision({ rec: { lastItem: 'Add search to the notes page', sameItem: 3 }, scan: scan(), next: { state: 'open', source: 'project', text: 'Add search to the notes page' } }),
    'the step limit': persistDecision({ rec: { steps: 25 }, scan: scan() }),
    'no visible work': persistDecision({ scan: scan({ progressed: false }) }),
    'the user spoke and nothing was done': persistDecision({ rec: { waitingOn: 'srv' }, scan: scan({ progressed: false, prompted: true }), outstanding: true, waitingOn: 'srv', commandsOnly: true }),
    'only waited, nothing out': persistDecision({ rec: { waitTold: true }, scan: scan({ progressed: false, waitClaim: true }), idleKnown: true }),
  };
  for (const [label, dec] of Object.entries(lines)) check(label, stopLine(dec));
});

test('the size-limit stops keep the size for the lead, and show the user none', () => {
  for (const advice of [{ action: 'investigate' }, { action: 'compact', fresh: true }]) {
    const dec = persistDecision({ scan: scan(), contextAdvice: advice, contextReading: { tokens: 150000, session: 'sess-1', compactions: 3 } });
    assert.match(dec.why, /~150k/, 'the record and the lead still get the size');
    assert.doesNotMatch(endMessage(dec.say || dec.why), /checkpoint|~\d+k/i);
  }
});

test('every band line and pause text is in plain words', () => {
  const now = Date.parse('2026-10-03T09:00:00.000Z');
  const at = new Date(now).toISOString();
  const lines = {
    'paused, keep-going on': bandLine({ pause: pauseRecord({ error: 'rate_limit', session: 's', now: new Date(now) }), session: 's', now }),
    'paused, keep-going off': bandLine({ pause: pauseRecord({ error: 'rate_limit', session: 's', now: new Date(now), armed: false }), session: 's', now }),
    'stopped on another error': bandLine({ pause: pauseRecord({ error: 'overloaded', session: 's', now: new Date(now) }), session: 's', now }),
    'needs you': bandLine({ band: { session: 's', kind: 'needs', text: 'Email or text message for the reminders?', at }, session: 's', now }),
    'working on': bandLine({ band: { session: 's', kind: 'working', text: 'Add search to the notes page', at }, session: 's', now }),
    'another session': bandLine({ band: { session: 'other', kind: 'working', text: 'Add search to the notes page', at }, session: 's', now }),
    'a long wait': bandLine({ band: { session: 's', kind: 'working', text: WAITING_TEXT, at }, session: 's', now: now + 250 * 60000 }),
  };
  for (const [label, line] of Object.entries(lines)) check(label, line);
});

test('the band names a run\'s task by its words, never its ledger id', async () => {
  const { withoutTaskIds } = await import('./lib/band-line.mjs');
  const now = Date.parse('2026-10-03T09:00:00.000Z');
  for (const raw of ['9-8-0001 add --since', 'Pickup prompt: send 9-8-0002 once the first lands']) {
    const line = bandLine({ band: { session: 's', kind: 'working', text: withoutTaskIds(raw), at: new Date(now).toISOString() }, session: 's', now });
    check(`working on ${raw}`, line);
  }
});

// The checks above ran on a tidied sample; a run whose dated Pickup was newer
// than its rows put the lead's own note on the band as written (whole-file
// review). This reads the line from a run on disk, as the hooks do.
test('the band\'s item from a real run is in plain words, a dated Pickup newer than the rows included', async () => {
  const { openItem } = await import('./lib/band.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const repo = mkdtempSync(join(tmpdir(), 'orch-plain-run-'));
  mkdirSync(join(repo, '.git'));
  const runDir = join(repo, '.orchestrator', 'runs', '20261003-x');
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, ['# Run', '', '## Goal', '', 'Ship it.', '', '## Tasks', '',
    '| id | phase | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|',
    '| 10-3-0002 | 🔨 running | implementer · sonnet | add the export button | test | 1 | sent 2026-10-03 09:00 |', '',
    '## Pickup', '', 'Pickup prompt: dispatch orch-reviewer on with the packet in returns/, then 0003 (2026-10-03 11:00)', ''].join('\n'));
  const now = Date.parse('2026-10-03T12:00:00.000Z');
  const text = openItem({ run: { root: repo, runMd, boundAt: new Date().toISOString() } }, repo);
  const line = bandLine({ band: { session: 's', kind: 'working', text, at: new Date(now).toISOString() }, session: 's', now });
  check('working on a run with a newer Pickup', line);
  assert.doesNotMatch(line, /returns\/|\b0003\b|11:00/, `the lead's note is not the line: "${line}"`);
  const dec = persistDecision({ rec: { lastItem: 'dispatch orch-reviewer on with the packet in returns/, then 0003', sameItem: 3 }, scan: scan(), next: { state: 'open', source: 'pickup', text: 'dispatch orch-reviewer on with the packet in returns/, then 0003' } });
  check('the same step still open, from a Pickup', stopLine(dec));
});

test('every error the pause record can name is in plain words', async () => {
  const { ERROR_WORDS } = await import('./lib/pause.mjs');
  const now = Date.parse('2026-10-03T09:00:00.000Z');
  for (const error of [...Object.keys(ERROR_WORDS), 'rate_limit', 'unknown', 'a_kind_nobody_has_seen']) {
    for (const armed of [true, false]) check(`paused on ${error}`, bandLine({ pause: pauseRecord({ error, session: 's', now: new Date(now), armed }), session: 's', now }));
  }
});

test('the status line footer is in plain words', () => {
  check('footer', footer({ model: 'Opus 5', contextPct: 34, fiveHour: { pct: 24, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, week: { pct: 41 } }));
});

test('the check itself fails the words it is there to catch', () => {
  for (const bad of ['Auto-continue stopped: a dispatch was denied', 'Dispatched to orch-coordinator', 'saved at /home/me/.claude/x.md', 'ctx 34%', 'the subagent hit its quota', 'compacted twice', 'the done-when is unchecked']) {
    assert.throws(() => check('sample', bad), undefined, bad);
  }
});
