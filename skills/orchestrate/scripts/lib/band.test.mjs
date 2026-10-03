// lib/band.test.mjs — the band's pure parts (the line, the record's shape, what
// a Stop leaves) and the file helpers the hooks write through. The hook runs
// that use them are in band-hooks.test.mjs; the mod that draws the line is held
// by band-mod.test.mjs. docs/band.md says what each case is for.
//   node --test skills/orchestrate/scripts/lib/band.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAND_KINDS, BAND_TEXT_CAP, OTHER_SESSION_MS, OTHER_SESSION_TAG, WAITING_TEXT, KEEP_GOING_CLAUSE,
  bandClip, bandRecord, parseBand, parsePauseText, bandLine, bandAtStop, bandAtPrompt, waitedFor, withoutTaskIds,
} from './band-line.mjs';
import { BAND_REL, bandPath, readBand, writeBand, recordBand, recordStopBand, stopKey, HOLD_MS, openItem, sessionGoal, turnText, stopQuestion } from './band.mjs';
import { pauseRecord, writePause, clearPause, readPause, pausePath } from './pause.mjs';

const NOW = Date.parse('2026-10-03T09:00:00.000Z');
const at = ms => new Date(NOW + ms).toISOString();
const tmp = () => mkdtempSync(join(tmpdir(), 'orch-band-lib-'));
const band = (kind, text, extra = {}) => bandRecord({ session: 's1', kind, text, now: new Date(NOW), ...extra });
const pause = (error = 'rate_limit', extra = {}) => parsePauseText(JSON.stringify({ ...pauseRecord({ error, session: 's1', now: new Date(NOW) }), ...extra }));
const line = (args) => bandLine({ session: 's1', now: NOW, ...args });

// ---- the clip --------------------------------------------------------------------
test('bandClip collapses spaces and line breaks and never rewords what the user said', () => {
  assert.equal(bandClip('  add a  --json flag\nto the   status command\t'), 'add a --json flag to the status command');
  assert.equal(bandClip(null), '');
  assert.equal(bandClip(undefined), '');
  assert.equal(bandClip('   \n  '), '');
  assert.equal(bandClip('Fix the "date" parser (it drops Z)'), 'Fix the "date" parser (it drops Z)', 'quotes and brackets stay as typed');
});

test('bandClip cuts at the cap, ends the cut with three dots and stays within it', () => {
  assert.equal(BAND_TEXT_CAP, 100);
  const exact = 'a'.repeat(BAND_TEXT_CAP);
  assert.equal(bandClip(exact), exact, 'a text of exactly the cap is left whole');
  const cut = bandClip('word '.repeat(60));
  assert.ok(cut.length <= BAND_TEXT_CAP, `cut to ${cut.length}`);
  assert.ok(cut.endsWith('...'));
  assert.ok(!cut.endsWith(' ...'), 'no space left before the dots');
  assert.ok(cut.startsWith('word word word'), 'the start of the user\'s words is kept as typed');
  assert.equal(bandClip('abcdefghij', 6), 'abc...', 'a smaller cap is honoured');
});

// ---- the record --------------------------------------------------------------------
test('a record carries exactly session, kind, text and at, in that meaning', () => {
  const rec = band('working', 'fix the date parser');
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'kind', 'session', 'text']);
  assert.deepEqual(rec, { session: 's1', kind: 'working', text: 'fix the date parser', at: '2026-10-03T09:00:00.000Z' });
  assert.equal(new Date(rec.at).toISOString(), rec.at, 'at is an ISO time');
  assert.deepEqual(BAND_KINDS, ['working', 'needs', 'idle']);
});

test('an idle record carries no text, an unknown kind is idle, a missing session is null', () => {
  assert.equal(band('idle', 'left over words').text, '');
  assert.equal(band('dancing', 'x').kind, 'idle');
  assert.equal(band('dancing', 'x').text, '');
  assert.equal(band('working', 'x', { session: undefined }).session, null);
  assert.equal(band('working', 'x', { session: '' }).session, null);
  assert.equal(band('working', 'x', { session: 42 }).session, '42');
});

test('a record\'s text is clipped when it is made', () => {
  assert.ok(band('needs', 'q'.repeat(500)).text.length <= BAND_TEXT_CAP);
  assert.equal(band('needs', 'two\nlines  here').text, 'two lines here');
});

test('parseBand reads back what bandRecord made, and refuses anything that is not a record', () => {
  const rec = band('needs', 'Postgres or SQLite?');
  assert.deepEqual(parseBand(JSON.stringify(rec)), rec);
  assert.deepEqual(parseBand(JSON.stringify({ ...rec, extra: 1 })), rec, 'unknown keys are dropped');
  for (const bad of ['', 'not json', '[]', 'null', '7', '{}',
    JSON.stringify({ ...rec, kind: 'dancing' }),
    JSON.stringify({ ...rec, text: 5 }),
    JSON.stringify({ ...rec, at: undefined })]) {
    assert.equal(parseBand(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseBand(JSON.stringify({ ...rec, session: 12 })).session, '12');
});

// ---- the pause reader agrees with the pause module -----------------------------------
test('parsePauseText gives the same answer as readPause for every state a pause file can be in', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.orchestrator'));
  const file = pausePath(dir);
  const agree = (label) => {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const mine = parsePauseText(text);
    const theirs = readPause(dir);
    assert.equal(mine === null, theirs === null, `${label}: pause or no pause`);
    if (theirs) {
      for (const k of ['kind', 'at', 'text', 'session']) assert.equal(mine[k], theirs[k], `${label}: ${k}`);
    }
  };
  agree('no file');
  writePause(dir, pauseRecord({ error: 'rate_limit', session: 's1', now: new Date(NOW) }));
  agree('a usage limit');
  assert.equal(parsePauseText(readFileSync(file, 'utf8')).kind, 'usage_limit');
  writePause(dir, pauseRecord({ error: 'overloaded', session: 's1', now: new Date(NOW) }));
  agree('an API error');
  assert.equal(clearPause(dir, 's1', 'stop', new Date(NOW + 1000)), true);
  agree('a cleared pause');
  assert.equal(parsePauseText(readFileSync(file, 'utf8')), null);
  for (const [label, text] of [['garbage', 'not json'], ['an array', '[1]'], ['a wrong kind', JSON.stringify({ kind: 'sunny', at: at(0), text: 'x' })], ['no text', JSON.stringify({ kind: 'usage_limit', at: at(0) })]]) {
    writeFileSync(file, text);
    agree(label);
  }
});

// ---- the line --------------------------------------------------------------------
test('nothing to say is an empty line', () => {
  assert.equal(line({}), '');
  assert.equal(line({ pause: null, band: null }), '');
  assert.equal(bandLine(), '');
  assert.equal(line({ band: band('idle', '') }), '');
});

test('working and needs read as the spec words', () => {
  assert.equal(line({ band: band('working', 'Fix the date parser') }), 'Working on: Fix the date parser');
  assert.equal(line({ band: band('needs', 'Postgres or SQLite?') }), 'Needs you: Postgres or SQLite?');
});

test('a record with no words says nothing rather than a label with a blank after it', () => {
  assert.equal(line({ band: band('working', '') }), '');
  assert.equal(line({ band: band('needs', '   ') }), '');
});

test('the text is clipped to the cap in the line, in the user\'s own words', () => {
  const long = 'make the export keep the original timestamps when the file is copied across drives and also say so '.repeat(4);
  const out = line({ band: { ...band('working', 'x'), text: long } });
  assert.ok(out.startsWith('Working on: make the export keep the original timestamps'));
  assert.ok(out.length <= 'Working on: '.length + BAND_TEXT_CAP, `line is ${out.length}`);
  assert.ok(out.endsWith('...'));
});

test('a pause shows its own text, and wins over a question and over work', () => {
  const p = pause('rate_limit');
  assert.equal(line({ pause: p, band: band('needs', 'Postgres or SQLite?') }), 'Paused for the usage limit; keep-going stays on.');
  assert.equal(line({ pause: p, band: band('working', 'Fix the date parser') }), 'Paused for the usage limit; keep-going stays on.');
  assert.equal(line({ pause: p, band: null }), 'Paused for the usage limit; keep-going stays on.');
  assert.equal(line({ pause: pause('overloaded'), band: band('working', 'x') }), 'Stopped: Claude was too busy to answer.');
});

test('a cleared pause, or one with no words, gives way to the band', () => {
  assert.equal(line({ pause: { ...pause(), cleared: at(5) }, band: band('needs', 'which one?') }), 'Needs you: which one?');
  assert.equal(line({ pause: { ...pause(), text: '' }, band: band('working', 'x') }), 'Working on: x');
});

test('a record for this session, or with no session on either side, shows plain', () => {
  assert.equal(line({ band: band('working', 'x') }), 'Working on: x');
  assert.equal(bandLine({ session: null, band: band('working', 'x'), now: NOW }), 'Working on: x', 'the mod could not learn its own id');
  assert.equal(bandLine({ session: '', band: band('working', 'x'), now: NOW }), 'Working on: x');
  assert.equal(line({ band: band('working', 'x', { session: null }) }), 'Working on: x', 'the hook payload carried no id');
});

test('a mismatch of ids shows the line with the other-session tag, so a wrong id never hides it', () => {
  assert.equal(OTHER_SESSION_TAG, '(another session) ');
  const rec = band('working', 'x', { session: 'host-id-b' });
  assert.equal(line({ band: rec }), '(another session) Working on: x');
  assert.equal(line({ band: band('needs', 'which?', { session: 'host-id-b' }) }), '(another session) Needs you: which?');
  assert.equal(line({ pause: { ...pause(), session: 'host-id-b' }, band: null }), '(another session) Paused for the usage limit.', 'without the keep-going promise, which is the other session\'s');
});

// Another session's pause (one record per project) used to beat this session's
// own question and could not be cleared by it; after /clear a session's own
// pause reads as another session's the same way (whole-file review).
test('this session\'s own line beats another session\'s pause, which shows only when this session has nothing to say', () => {
  const theirs = { ...pause(), session: 'other' };
  assert.equal(KEEP_GOING_CLAUSE, '; keep-going stays on');
  assert.equal(line({ pause: theirs, band: band('needs', 'Postgres or SQLite?') }), 'Needs you: Postgres or SQLite?');
  assert.equal(line({ pause: theirs, band: band('working', 'add a dark mode toggle') }), 'Working on: add a dark mode toggle');
  assert.equal(line({ pause: theirs, band: band('idle', '') }), '(another session) Paused for the usage limit.');
  assert.equal(line({ pause: theirs, band: band('working', '') }), '(another session) Paused for the usage limit.', 'a prompt that named nothing is nothing to say');
  assert.equal(line({ pause: theirs, band: null }), '(another session) Paused for the usage limit.');
  assert.equal(line({ pause: theirs, band: band('working', 'add a dark mode toggle'), working: false }), '(another session) Paused for the usage limit.', 'a working line not drawn is nothing to say');
  assert.equal(line({ pause: theirs, band: band('needs', 'which?', { session: 'other' }) }), '(another session) Paused for the usage limit.', 'between two of the other session\'s, its pause first');
  assert.equal(line({ pause: { ...pause('overloaded'), session: 'other' }, band: null }), '(another session) Stopped: Claude was too busy to answer.');
  assert.equal(line({ pause: pause(), band: band('needs', 'which?') }), 'Paused for the usage limit; keep-going stays on.', 'this session\'s own pause still wins, with its promise');
});

// Esc ends a turn with no Stop, so the prompt's "Working on" was never
// rewritten and stayed up for good (whole-file review). The band's slot says
// whether a turn is running.
test('this session\'s own working line shows only while a turn is running; a wait, a question and a pause show either way', () => {
  const later = NOW + 6 * 60 * 60 * 1000;
  const working = band('working', 'add a --json flag');
  assert.equal(bandLine({ band: working, session: 's1', now: later }), 'Working on: add a --json flag', 'a host that does not say: as written');
  assert.equal(bandLine({ band: working, session: 's1', now: later, working: true }), 'Working on: add a --json flag');
  assert.equal(bandLine({ band: working, session: 's1', now: later, working: false }), '');
  assert.equal(line({ band: band('working', WAITING_TEXT), working: false }), `Working on: ${WAITING_TEXT}`);
  assert.equal(line({ band: band('needs', 'which?'), working: false }), 'Needs you: which?');
  assert.equal(line({ pause: pause(), band: working, working: false }), 'Paused for the usage limit; keep-going stays on.');
  assert.equal(line({ band: band('working', 'x', { session: 'other' }), working: false }), '(another session) Working on: x', 'whether this session runs says nothing of another one');
});

test('a record from another session stops showing after the window, and not before', () => {
  assert.equal(OTHER_SESSION_MS, 30 * 60 * 1000);
  const mk = ms => ({ ...band('working', 'x', { session: 'other' }), at: at(-ms) });
  assert.equal(line({ band: mk(29 * 60 * 1000) }), '(another session) Working on: x');
  assert.equal(line({ band: mk(OTHER_SESSION_MS) }), '(another session) Working on: x', 'the window includes its last millisecond');
  assert.equal(line({ band: mk(OTHER_SESSION_MS + 1) }), '');
  assert.equal(line({ band: mk(3 * 60 * 60 * 1000) }), '');
  // The same age under this session's own id is never hidden by age.
  assert.equal(line({ band: { ...band('working', 'x'), at: at(-3 * 60 * 60 * 1000) } }), 'Working on: x');
});

test('a clock that disagrees by a minute still shows; one far ahead, or a time that is not one, does not', () => {
  const mk = at2 => ({ ...band('working', 'x', { session: 'other' }), at: at2 });
  assert.equal(line({ band: mk(at(30 * 1000)) }), '(another session) Working on: x');
  assert.equal(line({ band: mk(at(2 * 60 * 1000)) }), '');
  assert.equal(line({ band: mk('not a time') }), '');
});

test('an old other-session pause does not hide this session\'s own record', () => {
  const old = { ...pause(), session: 'other', at: at(-2 * OTHER_SESSION_MS) };
  assert.equal(line({ pause: old, band: band('needs', 'which one?') }), 'Needs you: which one?');
});

// ---- what a Stop leaves ---------------------------------------------------------------
test('bandAtStop: a turn that goes on is work, whatever the last message said', () => {
  assert.deepEqual(bandAtStop({ continued: true, turn: 'add --since' }), { kind: 'working', text: 'add --since' });
  assert.deepEqual(bandAtStop({ continued: true }), { kind: 'working', text: '' });
  assert.equal(bandAtStop({ continued: true, question: 'which?' }).kind, 'working');
});

// The order was the stored item first, so a finished first request, or the
// project page's next step, stood above every later prompt (whole-file review).
test('bandAtPrompt: a new request wins over stored text, a resume names the stored item, anything else names nothing', () => {
  const stored = { open: 'Fix the date parser', goal: 'add a --json flag' };
  assert.deepEqual(bandAtPrompt({ request: 'now fix the login page', ...stored }), { kind: 'working', text: 'now fix the login page' });
  assert.deepEqual(bandAtPrompt({ request: 'now fix the login page', resumes: true, ...stored }), { kind: 'working', text: 'now fix the login page' });
  assert.deepEqual(bandAtPrompt({ resumes: true, ...stored }), { kind: 'working', text: 'Fix the date parser' });
  assert.deepEqual(bandAtPrompt({ resumes: true, goal: 'add a --json flag' }), { kind: 'working', text: 'add a --json flag' });
  assert.deepEqual(bandAtPrompt({ resumes: true }), { kind: 'working', text: '' });
  assert.deepEqual(bandAtPrompt({ ...stored }), { kind: 'working', text: '' }, 'a thank-you does not claim an older item');
  assert.deepEqual(bandAtPrompt(), { kind: 'working', text: '' });
  assert.equal(line({ band: band('working', bandAtPrompt({ ...stored }).text) }), '', 'and draws nothing');
});

test('bandAtStop: a closing question is needs, and comes before a wait', () => {
  assert.deepEqual(bandAtStop({ question: 'Postgres or SQLite?' }), { kind: 'needs', text: 'Postgres or SQLite?' });
  assert.deepEqual(bandAtStop({ question: 'Postgres or SQLite?', waiting: true }), { kind: 'needs', text: 'Postgres or SQLite?' });
});

test('bandAtStop: a wait is working on the wait, anything else is idle', () => {
  assert.equal(WAITING_TEXT, 'waiting on a helper or background command');
  assert.deepEqual(bandAtStop({ waiting: true }), { kind: 'working', text: WAITING_TEXT });
  assert.deepEqual(bandAtStop({}), { kind: 'idle', text: '' });
  assert.deepEqual(bandAtStop(), { kind: 'idle', text: '' });
  assert.deepEqual(bandAtStop({ open: 'x', goal: 'y' }), { kind: 'idle', text: '' }, 'an item and a goal alone do not make a finished turn busy');
});

test('a wait says how long it has gone on, from its first minute; other work lines carry no clock', () => {
  const at = '2026-10-03T10:00:00.000Z';
  const t = Date.parse(at);
  const wait = m => bandLine({ band: { session: 's1', kind: 'working', text: WAITING_TEXT, at }, session: 's1', now: t + m * 60000 });
  assert.equal(wait(0), `Working on: ${WAITING_TEXT}`);
  assert.equal(wait(0.9), `Working on: ${WAITING_TEXT}`, 'nothing under a minute');
  assert.equal(wait(1), `Working on: ${WAITING_TEXT}, 1 min so far`);
  assert.equal(wait(59), `Working on: ${WAITING_TEXT}, 59 min so far`);
  assert.equal(wait(60), `Working on: ${WAITING_TEXT}, 1 h so far`);
  assert.equal(wait(250), `Working on: ${WAITING_TEXT}, 4 h 10 min so far`);
  assert.equal(bandLine({ band: { session: 's1', kind: 'working', text: 'Add search', at }, session: 's1', now: t + 3600000 }), 'Working on: Add search');
  assert.equal(waitedFor('not a time', t), '');
  assert.equal(waitedFor(at, t - 120000), '', 'a clock behind the record says nothing');
});

// A date the user wrote has the shape of a task id (M-D-NNNN) and was taken out
// with the ids (whole-file review). A task id's counter starts with 0.
test('withoutTaskIds takes out the ledger\'s task ids and leaves a date the user wrote', () => {
  assert.equal(withoutTaskIds('Ship the 10-3-2026 release notes'), 'Ship the 10-3-2026 release notes');
  assert.equal(withoutTaskIds('9-8-0001 add --since'), 'add --since');
  assert.equal(withoutTaskIds('10-3-0012: wire the export'), 'wire the export');
  assert.equal(withoutTaskIds('12-31-0999 last one'), 'last one');
  assert.equal(withoutTaskIds('10-3-0001 deploy it (blocked on 10-3-0002 and 10-3-0003)'), 'deploy it (waiting on another step)');
  assert.equal(withoutTaskIds('deploy it (blocked on 10-3-2026)'), 'deploy it (blocked on 10-3-2026)', 'a date in the note is not an id');
  assert.equal(withoutTaskIds('meet on 1-15-2027 about 10-3-0004'), 'meet on 1-15-2027 about');
  const open = `(blocked on ${' '.repeat(5000)}x`;
  assert.equal(withoutTaskIds(open), '(blocked on x', 'no runaway match on a note that never closes');
});

// ---- the file --------------------------------------------------------------------------
test('the record lives at .orchestrator/band.json beside the pause record', () => {
  assert.equal(BAND_REL, join('.orchestrator', 'band.json'));
  assert.equal(bandPath('/r'), join('/r', '.orchestrator', 'band.json'));
  assert.equal(dirname(bandPath('/r')), dirname(pausePath('/r')));
});

test('writeBand writes only where the .orchestrator folder already is, and makes no folder of its own', () => {
  const bare = tmp();
  assert.equal(writeBand(bare, band('working', 'x')), false);
  assert.equal(existsSync(join(bare, '.orchestrator')), false, 'no stray folder in a project the plugin has not touched');
  assert.equal(readBand(bare), null);

  const dir = tmp();
  mkdirSync(join(dir, '.orchestrator'));
  const rec = band('needs', 'which one?');
  assert.equal(writeBand(dir, rec), true);
  assert.deepEqual(readBand(dir), rec);
  // The .gitignore beside it keeps this computer's state out of commits (lib/pause.mjs).
  assert.deepEqual(readdirSync(join(dir, '.orchestrator')).sort(), ['.gitignore', 'band.json'], 'no temporary file left behind');

  const made = tmp();
  assert.equal(writeBand(made, rec, { create: true }), true, 'an explicit create is allowed');
  assert.deepEqual(readBand(made), rec);
});

test('writeBand and readBand take no root, no record or a broken file without throwing', () => {
  assert.equal(writeBand('', band('working', 'x')), false);
  assert.equal(writeBand(tmp(), null), false);
  assert.equal(readBand(''), null);
  assert.equal(readBand(null), null);
  const dir = tmp();
  mkdirSync(join(dir, '.orchestrator'));
  writeFileSync(bandPath(dir), 'not json');
  assert.equal(readBand(dir), null);
});

test('recordBand finds the git root from a folder inside it, as the pause record does', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.orchestrator'));
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  const rec = recordBand({ cwd: join(repo, 'src', 'deep'), session: 's9', kind: 'working', text: 'fix it', now: new Date(NOW) });
  assert.deepEqual(rec, { session: 's9', kind: 'working', text: 'fix it', at: '2026-10-03T09:00:00.000Z' });
  assert.deepEqual(readBand(repo), rec);
  assert.equal(existsSync(join(repo, 'src', 'deep', '.orchestrator')), false);
});

test('recordBand with no folder, or no .orchestrator folder, writes nothing and returns null', () => {
  assert.equal(recordBand({ kind: 'working', text: 'x' }), null);
  assert.equal(recordBand({ cwd: '', kind: 'working', text: 'x' }), null);
  const bare = tmp();
  assert.equal(recordBand({ cwd: bare, kind: 'working', text: 'x' }), null);
  assert.equal(existsSync(join(bare, '.orchestrator')), false);
  assert.equal(recordBand(), null);
});

// ---- what a hook has to name -------------------------------------------------------------
test('sessionGoal is the keep-going goal while it is on, else the pinned goal, else nothing', () => {
  assert.equal(sessionGoal({ persist: { armed: true, goal: 'ship the site' }, goal: 'first request' }), 'ship the site');
  assert.equal(sessionGoal({ persist: { armed: false, goal: 'ship the site' }, goal: 'first request' }), 'first request');
  assert.equal(sessionGoal({ goal: 'first request' }), 'first request');
  assert.equal(sessionGoal({}), '');
  assert.equal(sessionGoal(null), '');
});

const PAGE = '# Project\n\n## Next\n\n1. Fix the date parser\n2. Later thing\n';
const HEAD = ['| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |', '|---|---|---|---|---|---|---|---|---|'];
const row = (id, phase, task) => `| ${id} | ${phase} | — | src/x.ts | implementer · sonnet | ${task} | exit 0 | 0 | — |`;
const runMd = rows => ['# Run', '', '## Goal', '', 'Ship it.', '', '## Done when', '', '- tests pass', '', '## Tasks', '', ...HEAD, ...rows, '', '## Pickup', '', '', '## Verified vs inherited', ''].join('\n');

test('openItem names the run\'s next task, else the project page\'s next step, else nothing', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  assert.equal(openItem({}, repo), '', 'no page, no run');
  mkdirSync(join(repo, '.orchestrator'), { recursive: true });
  writeFileSync(join(repo, '.orchestrator', 'PROJECT.md'), PAGE);
  assert.equal(openItem({}, repo), 'Fix the date parser');
  mkdirSync(join(repo, 'sub'));
  assert.equal(openItem({}, join(repo, 'sub')), 'Fix the date parser', 'a session started below the repository root still finds the page');

  const runDir = join(repo, '.orchestrator', 'runs', '20261003-x');
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, 'RUN.md');
  writeFileSync(file, runMd([row('10-3-0001', '✅ done', 'first'), row('10-3-0002', '🔨 running', 'second')]));
  assert.equal(openItem({ run: { root: repo, runMd: file } }, repo), 'second', 'the task by its words, without the ledger id');
  writeFileSync(file, runMd([row('10-3-0001', '✅ done', 'first')]));
  assert.equal(openItem({ run: { root: repo, runMd: file } }, repo), '', 'every task done: nothing open to name');
});

// A session bound to a run closed as dropped kept naming its stuck row
// (whole-file review): the binding is read through the same check the turn
// checks use (lib/runs.mjs `boundRun`).
test('openItem names nothing from a run that is closed, unless it was bound on purpose after it closed', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  const runDir = join(repo, '.orchestrator', 'runs', '20261003-dates');
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, 'RUN.md');
  writeFileSync(file, runMd([row('10-3-0001', '🧱 stuck', 'rewrite the date parser')]).replace('# Run\n', '# Run\n\nClosed: dropped, the user went another way\n'));
  const binding = { root: repo, runMd: file, boundAt: '2026-10-01T00:00:00.000Z' };
  assert.equal(openItem({ run: binding }, repo), '', 'a closed run names nothing');
  assert.equal(openItem({ run: { ...binding, explicit: true, boundAt: new Date(Date.now() + 60000).toISOString() } }, repo), 'rewrite the date parser', 'bound on purpose after it closed: it is the run');
  writeFileSync(join(repo, '.orchestrator', 'PROJECT.md'), PAGE);
  assert.equal(openItem({ run: binding }, repo), 'Fix the date parser', 'the project page still answers');
});

// A dated Pickup newer than the rows was shown as written: role names, a
// folder, a task number, a time (whole-file review).
test('openItem names the run\'s task by its row, never the lead\'s Pickup note', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  const runDir = join(repo, '.orchestrator', 'runs', '20261003-x');
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, 'RUN.md');
  const sent = row('10-3-0002', '🔨 running', 'add the export button').replace(/— \|$/, 'sent 2026-10-03 09:00 |');
  writeFileSync(file, runMd([sent]).replace('## Pickup\n\n', '## Pickup\n\nPickup prompt: dispatch orch-reviewer on with the packet in returns/, then 0003 (2026-10-03 11:00)\n'));
  assert.equal(openItem({ run: { root: repo, runMd: file, boundAt: new Date().toISOString() } }, repo), 'add the export button');
});

test('turnText: with keep-going on, the next open item or the goal; otherwise what the turn\'s prompt put on the band', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.orchestrator'));
  writeFileSync(join(repo, '.orchestrator', 'PROJECT.md'), PAGE);
  const armed = { persist: { armed: true, goal: 'ship the site' } };
  assert.equal(turnText({ ...armed, bandText: 'now fix the login page' }, repo), 'Fix the date parser');
  assert.equal(turnText(armed, tmp()), 'ship the site');
  assert.equal(turnText({ goal: 'add a --json flag', bandText: 'now fix the login page' }, repo), 'now fix the login page');
  assert.equal(turnText({ goal: 'add a --json flag', bandText: '' }, repo), '', 'a prompt that named nothing: nothing, not a stored item');
  assert.equal(turnText({ goal: 'add a --json flag' }, repo), '');
  assert.equal(turnText(null, repo), '');
});

// The two Stop hooks run side by side; either may refuse. persist-check wrote
// "Needs you" while turn-check refused the same Stop (whole-file review).
test('recordStopBand: a refusal\'s line stands for its own Stop, whichever of the two hooks wrote first', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, '.orchestrator'));
  const input = { session_id: 's1', transcript_path: '/t.jsonl', last_assistant_message: 'Do you want the header too?', stop_hook_active: false };
  const key = stopKey(input);
  const now = new Date(NOW);
  const hold = () => recordStopBand({ cwd: dir, session: 's1', kind: 'working', text: 'change the footer', hold: key, key, now });
  const needs = (k = key, when = now) => recordStopBand({ cwd: dir, session: 's1', kind: 'needs', text: 'Do you want the header too?', key: k, now: when });

  assert.ok(needs(), 'the other hook first');
  assert.ok(hold(), 'the refusal second: it writes');
  assert.equal(line({ band: readBand(dir) }), 'Working on: change the footer');
  assert.equal(needs(), null, 'the refusal first: the other hook leaves its line');
  assert.equal(line({ band: readBand(dir) }), 'Working on: change the footer');
  assert.equal(readBand(dir).hold, key);

  const after = { ...input, stop_hook_active: true };
  assert.notEqual(stopKey(after), key, 'the Stop after the refusal is another Stop, even on the same words');
  assert.ok(needs(stopKey(after), new Date(NOW + 5000)));
  assert.equal(line({ band: readBand(dir) }), 'Needs you: Do you want the header too?');
  hold();
  assert.ok(needs(key, new Date(NOW + HOLD_MS + 1000)), 'a hold long past is not this Stop\'s');
  assert.equal(recordStopBand({ cwd: tmp(), session: 's1', kind: 'needs', text: 'x', key }), null, 'no .orchestrator folder: nothing');
  assert.ok(!existsSync(join(dir, '.orchestrator', 'band.json.lock')), 'the lock is let go');
});

test('a hold is kept by the record\'s reader, and only on a working record', () => {
  assert.equal(band('working', 'x', { hold: 'k1' }).hold, 'k1');
  assert.equal(band('needs', 'x', { hold: 'k1' }).hold, undefined);
  assert.deepEqual(Object.keys(band('working', 'x')).sort(), ['at', 'kind', 'session', 'text'], 'no hold, no key');
  assert.equal(parseBand(JSON.stringify(band('working', 'x', { hold: 'k1' }))).hold, 'k1');
});

test('openItem never throws on a state it cannot read', () => {
  assert.equal(openItem(null, null), '');
  assert.equal(openItem({ run: { runMd: '/nope/RUN.md', root: '/nope' } }, '/nope'), '');
});

test('stopQuestion reads the Stop payload\'s closing message first, then the transcript', () => {
  assert.equal(stopQuestion({ last_assistant_message: 'Done with the header. Postgres or SQLite?' }), 'Postgres or SQLite?');
  assert.equal(stopQuestion({ last_assistant_message: 'All done.' }), null);
  const dir = tmp();
  const t = join(dir, 't.jsonl');
  writeFileSync(t, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Which database do you want?' }] } }) + '\n');
  assert.equal(stopQuestion({ transcript_path: t }), 'Which database do you want?');
  assert.equal(stopQuestion({ last_assistant_message: '', transcript_path: t }), 'Which database do you want?');
  assert.equal(stopQuestion({ transcript_path: join(dir, 'missing.jsonl') }), null);
  assert.equal(stopQuestion({}), null);
  assert.equal(stopQuestion(null), null);
});

// ---- the doc ----------------------------------------------------------------------------
test('docs/band.md names the file, the kinds, every field the record carries and the finding it rests on', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const doc = readFileSync(join(root, 'docs', 'band.md'), 'utf8');
  assert.ok(doc.includes(BAND_REL.replace(/\\/g, '/')), 'the doc says where the record lives');
  for (const kind of BAND_KINDS) assert.ok(doc.includes(kind), `the doc names the ${kind} kind`);
  for (const key of Object.keys(band('working', 'x'))) assert.ok(doc.includes(`"${key}"`), `the doc's sample record shows ${key}`);
  for (const phrase of ['Working on:', 'Needs you:', '(another session)', 'modules', 'hooks/band.mjs', 'AbovePrompt']) assert.ok(doc.includes(phrase), `the doc says ${phrase}`);
  assert.ok(doc.includes(String(BAND_TEXT_CAP)), 'the doc says the clip');
  assert.ok(doc.includes(String(OTHER_SESSION_MS / 60000)), 'the doc says how long another session\'s record shows, in minutes');
  assert.ok(doc.includes(`at most ${HOLD_MS / 1000} seconds old`), 'the doc says how long a refusal\'s hold counts');
  assert.ok(doc.includes('"hold"') || doc.includes('`hold`'), 'the doc names the hold');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('docs/band.md'), 'the README points at the page');
});
