// note-facts.test.mjs — hook notes state facts, not orders (AGENTS.md: "Hooks
// state facts the lead cannot see; they do not give orders"). Pins the new
// wording of notes that no behavioural test reaches; the others are pinned
// where they are exercised (context.test, workers.test, resume.test ...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadNote, unreturnedNote } from './router.mjs';
import { heartbeatDecision } from './turn-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(here, f), 'utf8');

test('the unreturned-helper note states what resuming costs, with no instruction', () => {
  const note = unreturnedNote({ dispatches: [{ agent: 'orch-implementer', task: '9-9-0002', progress: '/r/p.md', at: '1' }], returned: [] });
  assert.match(note, /only narrows this list, so one of these may yet be working\./);
  assert.match(note, /leaves its notes and branch; resuming the stopped agent re-reads its whole context at full price\./);
  assert.doesNotMatch(note, /continue it with a fresh dispatch|check before treating/);
});

test('the lead-setting note states the cost and when a change lands', () => {
  // A fresh folder each run: leadNote records that it was shown, and a record
  // left from an earlier run would silence it.
  const dir = mkdtempSync(join(tmpdir(), 'orch-lead-note-'));
  let note;
  try { note = leadNote({ model: 'opus', effort: 'xhigh' }, 'pro', 1, join(dir, 'seen.json')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(note, /A change takes effect in a new session; switching mid-session re-reads everything uncached\./);
  assert.doesNotMatch(note, /better default|Mention it/);
});

test('the idle note states that a background dispatch returns control at once', () => {
  const d = heartbeatDecision({ run: { ready: ['9-9-0005', '9-9-0006'] }, rec: { turns: 3 } });
  assert.match(d.why, /nothing new has been dispatched this turn\. A background dispatch hands control straight back\.$/);
});

test('the usage-band lines give the percentage and no orders', () => {
  const r = src('router.mjs');
  assert.match(r, /the 5-hour window is at \$\{Math\.round\(h\.pct\)\}% \(resets \$\{resetClock\(h\.resetsAt\)\}\)\. No new helpers will start\.`/);
  assert.match(r, /the 5-hour window is at \$\{Math\.round\(h\.pct\)\}%; new helpers stop starting at \$\{HELPER_STOP_FIVE_HOUR\}%\.`/);
  assert.doesNotMatch(r, /Work serially|keep steps few/);
});

test('the Stop notes for review and Pickup state the fact only', () => {
  const t = src('turn-check.mjs');
  assert.match(t, /It clears on a passing orch-reviewer with REVIEW OF: \$\{rh\.task\}, or a closing line saying why the review was skipped\./);
  assert.match(t, /the independent look came back with no verdict\. \$\{clears\}/);
  assert.match(t, /the independent look found a problem\. \$\{clears\}/);
  assert.match(t, /returned done with none sent\. \$\{clears\}/);
  assert.match(t, /The Pickup section of \$\{run\.runMd\} \(one sentence that continues from here, its confidence, the resume risk\) is the only thing the next session reads first\./);
  assert.doesNotMatch(t, /Dispatch orch-reviewer with|Before this turn ends, update/);
});

test('the armed persist line no longer tells the lead how to wait', () => {
  assert.doesNotMatch(src('lib/persist-words.mjs'), /Monitor it and keep doing/);
});
