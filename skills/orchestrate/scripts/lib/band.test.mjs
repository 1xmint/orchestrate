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
  BAND_KINDS, BAND_TEXT_CAP, OTHER_SESSION_MS, OTHER_SESSION_TAG, WAITING_TEXT,
  bandClip, bandRecord, parseBand, parsePauseText, bandLine, bandAtStop,
} from './band-line.mjs';
import { BAND_REL, bandPath, readBand, writeBand, recordBand, openItem, sessionGoal, stopQuestion } from './band.mjs';
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
  assert.equal(line({ pause: pause('overloaded'), band: band('working', 'x') }), 'Stopped on an API error (overloaded); keep-going stays on.');
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
  assert.equal(line({ pause: { ...pause(), session: 'host-id-b' }, band: null }), '(another session) Paused for the usage limit; keep-going stays on.');
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
  assert.deepEqual(bandAtStop({ continued: true, open: '9-8-0001 add --since', goal: 'ship the site' }), { kind: 'working', text: '9-8-0001 add --since' });
  assert.deepEqual(bandAtStop({ continued: true, goal: 'ship the site' }), { kind: 'working', text: 'ship the site' });
  assert.deepEqual(bandAtStop({ continued: true }), { kind: 'working', text: '' });
  assert.equal(bandAtStop({ continued: true, question: 'which?' }).kind, 'working');
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
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('docs/band.md'), 'the README points at the page');
});
