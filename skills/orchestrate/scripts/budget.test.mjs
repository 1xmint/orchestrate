// budget.test.mjs — the budget of record, the spend gate's arithmetic, per-run
// spend, and the readiness signal that tells "nothing ready" from "no edges".
// All offline: temp files only, no network, no model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBudget, runSpend, readRun } from './lib/tier.mjs';
import { overCeiling, budgetDecision } from './guard-agent.mjs';

function tmpRun(runMdText, returnsJsonl) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-budget-'));
  const runDir = join(dir, '.orchestrator', 'runs', '20260910-x');
  mkdirSync(runDir, { recursive: true });
  const runMd = join(runDir, 'RUN.md');
  writeFileSync(runMd, runMdText);
  if (returnsJsonl != null) {
    mkdirSync(join(runDir, 'returns'), { recursive: true });
    writeFileSync(join(runDir, 'returns', 'returns.jsonl'), returnsJsonl);
  }
  return { runMd, runDir };
}

const WITH_COLUMN = `# Run

## Budget

Ceiling: $150 at list price · sessions: ~3 · set 2026-09-10

## Tasks

| id | phase | blocks on | owns | role · model | task | acceptance | attempts | result |
|---|---|---|---|---|---|---|---|---|
| 9-9-0001 | ✅ done | — | a | i · opus | did it | ok | 1 | done |
| 9-9-0002 | 📋 planned | 9-9-0001 | b | i · opus | next | ev | 0 | — |
| 9-9-0003 | 📋 planned | 9-9-0002 | c | i · opus | later | ev | 0 | — |

## Pickup

Pickup prompt: keep going
`;

const NO_COLUMN = `# Run

## Tasks

| id | phase | role · model | task | rubric | attempts | evidence |
|---|---|---|---|---|---|---|
| 9-9-0001 | ✅ done | i · opus | did it | ok | 1 | done |
| 9-9-0002 | 📋 planned | i · opus | next | ev | 0 | — |
`;

test('parseBudget reads a dollar ceiling, and none when absent', () => {
  assert.equal(parseBudget(WITH_COLUMN).ceiling, 150);
  assert.equal(parseBudget(NO_COLUMN).ceiling, null);
  assert.equal(parseBudget('## Budget\n\nCeiling: <set this with the user>\n').ceiling, null);
});

test('readRun computes readiness and no edges-missing when the column is present', () => {
  const { runMd } = tmpRun(WITH_COLUMN);
  const r = readRun(runMd);
  assert.deepEqual(r.ready, ['9-9-0002'], 'the task whose only blocker is done is ready; the one behind it is not');
  assert.equal(r.edgesMissing, false);
  assert.equal(r.budget.ceiling, 150);
  assert.equal(r.done, 1);
  assert.equal(r.rows, 3);
});

test('readRun flags edges-missing when planned rows exist but the column does not', () => {
  const { runMd } = tmpRun(NO_COLUMN);
  const r = readRun(runMd);
  assert.deepEqual(r.ready, [], 'no column means no readiness can be computed');
  assert.equal(r.edgesMissing, true, 'and that is reported, not silently empty — the bug that cost 20% of a plan');
});

test('runSpend sums the priced returns, and is null before any land', () => {
  const { runMd, runDir } = tmpRun(WITH_COLUMN,
    JSON.stringify({ task: '9-9-0001', dollars: 21.57 }) + '\n' +
    JSON.stringify({ task: '9-9-0002', dollars: 14.8 }) + '\n' +
    JSON.stringify({ task: '9-9-0003' }) + '\n'); // no dollars: ignored
  assert.equal(Math.round(runSpend(runDir) * 100) / 100, 36.37);
  assert.equal(readRun(runMd).spend, runSpend(runDir));
  const { runDir: empty } = tmpRun(WITH_COLUMN);
  assert.equal(runSpend(empty), null);
});

test('overCeiling: crosses, does not cross, and nothing to decide', () => {
  assert.equal(overCeiling(140, 20, 150).total, 160);
  assert.equal(overCeiling(100, 20, 150), null, 'under the ceiling passes');
  assert.equal(overCeiling(100, 20, null), null, 'no ceiling, no gate');
  assert.equal(overCeiling(100, null, 150), null, 'no price for the dispatch, no gate');
});

test('budgetDecision denies over the ceiling, passes under it, and passes with no ceiling', () => {
  const ti = { subagent_type: 'orch-implementer', model: 'opus', prompt: 'TASK: 9-9-0009' };
  const input = { session_id: 'nobody' };
  const over = { runId: '20260910-x', budget: { ceiling: 0.01 }, spend: 0 };
  const d = budgetDecision(input, ti, over);
  assert.ok(d && d.runId === '20260910-x', 'a $0.01 ceiling is crossed by any real dispatch');
  const under = { runId: '20260910-x', budget: { ceiling: 100000 }, spend: 0 };
  assert.equal(budgetDecision(input, ti, under), null);
  const noCeiling = { runId: '20260910-x', budget: { ceiling: null }, spend: 0 };
  assert.equal(budgetDecision(input, ti, noCeiling), null);
  assert.equal(budgetDecision(input, { subagent_type: 'x', model: '', prompt: '' }, over), null, 'no model named, no gate');
});

// Proof on the real ledger this whole effort came from: the run that cost ~20%
// of a plan wrote its blocking edges as prose, with no `blocks on` column, so
// the old code returned [] and the router showed nothing ready. The fix reports
// it instead. Skipped cleanly on any machine that does not have this checkout.
test('the real radar ledger is correctly flagged as edges-missing', () => {
  const real = 'C:\\Users\\Josh\\Desktop\\GitHub\\radar-advanced-assistant\\.orchestrator\\runs\\20260909-plan-0011-private-trader\\RUN.md';
  if (!existsSync(real)) return; // portable: only runs where the checkout exists
  const r = readRun(real);
  assert.ok(r, 'the ledger reads');
  assert.equal(r.edgesMissing, true, 'no blocks-on column, planned rows present: exactly the silent failure, now surfaced');
});
