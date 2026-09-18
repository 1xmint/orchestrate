// suggest.test.mjs — the suggestions outbox: a return's SUGGEST line lands in
// one capped file, deduped by text, read only on request. The ledger hook is
// run as a real child process (fake HOME) so this also covers the wiring
// between ledger.mjs and suggest.mjs; suggest.mjs's own CLI is exercised the
// same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSuggestion, readSuggestions, clearSuggestions, formatShow, seedFromMarkdown, MAX_TEXT, MAX_ROWS } from './suggest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = n => join(HERE, n);

function home() {
  const h = mkdtempSync(join(tmpdir(), 'orch-sugg-home-'));
  mkdirSync(join(h, '.claude', 'orchestrate'), { recursive: true });
  return h;
}

function suggestPath(h) {
  return join(h, '.claude', 'orchestrate', 'suggestions.jsonl');
}

function runLedger(payload, h) {
  return spawnSync(process.execPath, [script('ledger.mjs')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: h, USERPROFILE: h },
  });
}

function runSuggest(args, h) {
  return spawnSync(process.execPath, [script('suggest.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: h, USERPROFILE: h },
  });
}

const GOOD_RETURN = txt => `TASK: 9-18-0006  ROLE: implementer
STATUS: DONE
RUN: 20260918-fixture
EVIDENCE: node --test passed
${txt}
`;

test('a return with SUGGEST leaves one row; a return without leaves no file', () => {
  const h = home();
  const r = runLedger({
    hook_event_name: 'SubagentStop',
    session_id: 's1',
    agent_type: 'orch-implementer',
    agent_id: 'a1',
    last_assistant_message: GOOD_RETURN('SUGGEST: Give helpers the map path up front.'),
  }, h);
  assert.equal(r.status, 0);
  const p = suggestPath(h);
  assert.ok(existsSync(p));
  const rows = readSuggestions(p);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'Give helpers the map path up front.');
  assert.equal(rows[0].count, 1);
  assert.ok(rows[0].first);
  assert.equal(rows[0].first, rows[0].last);

  const h2 = home();
  const r2 = runLedger({
    hook_event_name: 'SubagentStop',
    session_id: 's2',
    agent_type: 'orch-implementer',
    agent_id: 'a2',
    last_assistant_message: GOOD_RETURN(''),
  }, h2);
  assert.equal(r2.status, 0);
  assert.equal(existsSync(suggestPath(h2)), false);
});

test('text over 240 chars is stored capped at 240', () => {
  const h = home();
  const long = 'x'.repeat(300);
  addSuggestion(long, { path: suggestPath(h) });
  const rows = readSuggestions(suggestPath(h));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text.length, MAX_TEXT);
});

test('the same text twice is one row with count 2', () => {
  const h = home();
  const p = suggestPath(h);
  addSuggestion('Same suggestion.', { path: p, now: () => '2026-09-18T00:00:00.000Z' });
  addSuggestion('  Same suggestion.  ', { path: p, now: () => '2026-09-18T01:00:00.000Z' });
  const rows = readSuggestions(p);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].first, '2026-09-18T00:00:00.000Z');
  assert.equal(rows[0].last, '2026-09-18T01:00:00.000Z');
});

test('keeps only the last 300 rows', () => {
  const h = home();
  const p = suggestPath(h);
  for (let i = 0; i < 305; i++) addSuggestion(`suggestion ${i}`, { path: p });
  const rows = readSuggestions(p);
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(rows[0].text, 'suggestion 5');
  assert.equal(rows[rows.length - 1].text, 'suggestion 304');
});

test('show --clear prints then empties the file', () => {
  const h = home();
  const r1 = runSuggest(['add', 'Note this for later.'], h);
  assert.equal(r1.status, 0);
  const r2 = runSuggest(['show', '--clear'], h);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /Note this for later\./);
  const rows = readSuggestions(suggestPath(h));
  assert.equal(rows.length, 0);
});

test('show with nothing recorded says so, plainly', () => {
  const h = home();
  const r = runSuggest(['show'], h);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No suggestions\./);
});

test('formatShow lists newest first and shows counts above one', () => {
  const rows = [
    { text: 'first', count: 1, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T00:00:00.000Z', source: null },
    { text: 'second', count: 3, first: '2026-01-01T00:00:00.000Z', last: '2026-01-02T00:00:00.000Z', source: 'task-1' },
  ];
  const out = formatShow(rows);
  const lines = out.split('\n');
  assert.match(lines[0], /^\[3x\] second/);
  assert.match(lines[0], /task-1/);
  assert.match(lines[1], /^first/);
});

test('--seed reads one suggestion per "- " bullet from a markdown file', () => {
  const h = home();
  const md = join(h, 'seed.md');
  writeFileSync(md, '# Suggestions\n\n- 2026-09-18 · lead · First seeded note.\n- 2026-09-18 · Fable · Second seeded note.\nnot a bullet, skipped\n');
  const r = runSuggest(['--seed', md], h);
  assert.equal(r.status, 0);
  const rows = readSuggestions(suggestPath(h));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, '2026-09-18 · lead · First seeded note.');
  assert.equal(rows[1].text, '2026-09-18 · Fable · Second seeded note.');
});

test('seedFromMarkdown is available for programmatic seeding too', () => {
  const h = home();
  const p = suggestPath(h);
  const added = seedFromMarkdown('- one\n- two\nnope\n', { path: p });
  assert.deepEqual(added, ['one', 'two']);
  assert.equal(readSuggestions(p).length, 2);
});
