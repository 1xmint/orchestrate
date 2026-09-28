// context-advice.test.mjs — what to do about a reading: the thresholds, each
// action adviseContext can return, the checkpoint lookup, and the notice text.
//   node --test skills/orchestrate/scripts/lib/context-advice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  thresholds, adviseContext, contextEpoch, checkpointPath, hasCheckpoint, newestCheckpoint,
  switchAdvice, contextNotice, contextTick, formatReading,
} from './context-advice.mjs';
import { toReading } from './context-scan.mjs';
import { loadPolicy } from './policy.mjs';

const policy = () => loadPolicy(null);
const now = () => new Date().toISOString();
const measured = (tokens, extra = {}) => ({ ...toReading({ compaction: null, usage: { tokens, at: now() }, responses: 5, sawBoundary: false, host: null }), ...extra });
const provisional = tokens => toReading({ compaction: { uuid: 'c1', at: now(), preTokens: 300000, postTokens: tokens }, usage: null, responses: 0, sawBoundary: true, host: null });

// ---- thresholds -----------------------------------------------------------------

test('thresholds are the policy lines when the window is unknown', () => {
  const p = policy();
  const t = thresholds(measured(1000), p);
  assert.equal(t.compactAt, p.context.compactAt);
  assert.equal(t.checkpointAt, Math.min(p.context.checkpointAt, Math.floor(p.context.compactAt * 0.8)));
});

test('thresholds caps compactAt to a fraction of a known capacity, and derives checkpointAt from it', () => {
  const p = { context: { compactAt: 150000, checkpointAt: 120000, windowFraction: 0.5 } };
  const t = thresholds({ capacity: 100000 }, p);
  assert.equal(t.compactAt, 50000, 'min(150000, 100000*0.5)');
  assert.equal(t.checkpointAt, 40000, 'min(120000, compactAt*0.8)');
});

// ---- adviseContext: one test per action -----------------------------------------

test('adviseContext is "unknown" with no reading or a stale one, and says which', () => {
  assert.equal(adviseContext(null, policy()).action, 'unknown');
  const stale = { state: 'unknown', tokens: null, stale: true };
  assert.match(adviseContext(stale, policy()).why, /stale/);
});

test('adviseContext is "none" below the checkpoint line', () => {
  const { checkpointAt } = thresholds(null, policy());
  assert.equal(adviseContext(measured(checkpointAt - 1), policy()).action, 'none');
});

test('adviseContext is "checkpoint" from the checkpoint line up to the compact line', () => {
  const { checkpointAt, compactAt } = thresholds(null, policy());
  assert.equal(adviseContext(measured(checkpointAt), policy()).action, 'checkpoint');
  assert.equal(adviseContext(measured(compactAt - 1), policy()).action, 'checkpoint');
});

test('adviseContext is "compact" at the compact line, and recommends a fresh conversation after enough compactions', () => {
  const p = policy();
  const { compactAt } = thresholds(null, p);
  const a = adviseContext(measured(compactAt), p);
  assert.equal(a.action, 'compact');
  assert.equal(a.fresh, false);
  const many = adviseContext(measured(compactAt, { compactions: p.context.freshAfterCompactions }), p);
  assert.equal(many.fresh, true);
  assert.match(switchAdvice({ compactions: p.context.freshAfterCompactions }, many), /fresh conversation/);
  assert.match(switchAdvice({ compactions: 0 }, a), /compacting/);
});

test('adviseContext on a provisional reading waits below the line and investigates at it', () => {
  const { compactAt } = thresholds(null, policy());
  const below = adviseContext(provisional(20000), policy());
  assert.equal(below.action, 'none');
  assert.equal(below.key, 'c1|provisional');
  assert.equal(adviseContext(provisional(compactAt), policy()).action, 'investigate');
});

test('adviseContext investigates a measured reading still at the line right after a compaction', () => {
  const { compactAt } = thresholds(null, policy());
  const r = measured(compactAt, { compaction: { uuid: 'c2', at: now() }, responsesSinceCompaction: 1 });
  assert.equal(adviseContext(r, policy()).action, 'investigate');
});

test('the advice key carries the compaction epoch, so a compaction resets it', () => {
  assert.equal(contextEpoch(null), 'none');
  assert.equal(contextEpoch({ compaction: { uuid: 'abc' } }), 'abc');
  const before = adviseContext(measured(1000), policy()).key;
  const after = adviseContext(measured(1000, { compaction: { uuid: 'abc', at: now() }, responsesSinceCompaction: 9 }), policy()).key;
  assert.notEqual(before, after);
});

// ---- checkpoints ------------------------------------------------------------------

test('checkpointPath names the file by session before a compaction and by epoch after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  assert.equal(checkpointPath('s1', null, dir), join(dir, 's1', 'checkpoint-s1.md'));
  assert.equal(checkpointPath('s1', { compaction: { uuid: 'e9' } }, dir), join(dir, 's1', 'checkpoint-e9.md'));
});

test('hasCheckpoint finds the plugin checkpoint file for the current epoch only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const r = { compaction: { uuid: 'e1', at: now() } };
  assert.equal(hasCheckpoint('s1', r, { dir, plansDir: dir }), false);
  const p = checkpointPath('s1', r, dir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'goal: x\n');
  assert.equal(hasCheckpoint('s1', r, { dir, plansDir: dir }), true);
  assert.equal(newestCheckpoint('s1', r, { dir, plansDir: dir }).path, p);
  assert.equal(hasCheckpoint('s1', { compaction: { uuid: 'e2', at: now() } }, { dir, plansDir: dir }), false, 'a new epoch needs a new checkpoint');
});

test('a RUN.md counts as a checkpoint only when its Pickup prompt has real text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const r = { compaction: { uuid: 'e1', at: new Date(Date.now() - 60000).toISOString() } };
  const runMd = join(dir, 'RUN.md');
  writeFileSync(runMd, '# Run\n\n## Pickup\nPickup prompt: <fill in>\n');
  assert.equal(hasCheckpoint('s1', r, { dir, runMd, plansDir: dir }), false, 'a placeholder is not a checkpoint');
  writeFileSync(runMd, '# Run\n\n## Pickup\nPickup prompt: continue with step 3\n');
  assert.equal(hasCheckpoint('s1', r, { dir, runMd, plansDir: dir }), true);
});

// ---- notices ------------------------------------------------------------------------

test('contextNotice says the size at checkpoint and compact, explains investigate, and is empty otherwise', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const { checkpointAt, compactAt } = thresholds(null, p);
  const ctx = { policy: p, session: 's1', dir };
  const cp = measured(checkpointAt);
  assert.match(contextNotice(cp, adviseContext(cp, p), ctx), /^\[orchestrate · context\] ~\d+k.*newest checkpoint: none/);
  const full = measured(compactAt);
  assert.match(contextNotice(full, adviseContext(full, p), ctx), /^\[orchestrate · context\]/);
  const inv = provisional(compactAt);
  assert.match(contextNotice(inv, adviseContext(inv, p), ctx), /Compacting again will not help/);
  const small = measured(1000);
  assert.equal(contextNotice(small, adviseContext(small, p), ctx), '');
  assert.equal(contextNotice(null, null, ctx), '');
});

test('contextTick keys by epoch and step, and is silent for an unknown reading', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const every = p.context.tickEvery;
  const t = contextTick(measured(every * 2 + 1), p, { dir });
  assert.equal(t.key, 'none|2');
  assert.match(t.text, /^\[orchestrate · context\]/);
  assert.deepEqual(contextTick({ state: 'unknown', tokens: null }, p, { dir }), { key: null, text: '' });
});

test('formatReading states the size, the state, and the recommendation', () => {
  const r = measured(42000, { capacity: 200000, pct: 21 });
  const text = formatReading(r, adviseContext(r, policy()));
  assert.match(text, /^context: 42k of 200k \(21%\) — measured/);
  assert.match(text, /recommended: none/);
});
