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
  switchAdvice, contextNotice, contextTick, formatReading,resolveAutocompactWindow,
  postCompactionAskDue,
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

test('thresholds falls back to the resolved autocompact window when the reading carries no capacity', () => {
  const p = policy();
  const t = thresholds(null, p, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' } });
  assert.equal(t.compactAt, Math.floor(100000 * p.context.windowFraction), 'compactAt is the fraction of the window');
  assert.equal(t.checkpointAt, Math.floor(t.compactAt * 0.8), 'checkpointAt is derived from that compactAt');
  assert.ok(t.compactAt < p.context.compactAt, 'a 100k window is tighter than the policy default');
});

test('thresholds with no env and no settings keeps the policy numbers unchanged', () => {
  const p = policy();
  const t = thresholds(null, p, {});
  assert.equal(t.compactAt, p.context.compactAt);
  assert.equal(t.checkpointAt, p.context.checkpointAt);
});

test('thresholds with the autocompact window turned "off" also keeps the policy numbers unchanged', () => {
  const p = policy();
  const t = thresholds(null, p, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'off' } });
  assert.equal(t.compactAt, p.context.compactAt);
  assert.equal(t.checkpointAt, p.context.checkpointAt);
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

test('a reading that lands short of checkpointAt still asks when the last growth would cross compactAt', () => {
  const p = policy();
  const r = measured(119904, { lastDelta: 38904 });
  assert.equal(r.tokens < p.context.checkpointAt, true, 'fixture is below the checkpoint mark on its own');
  const a = adviseContext(r, p);
  assert.equal(a.action, 'checkpoint');
  assert.match(a.why, /would reach/);
});

test('the same short reading with a small last growth does not ask', () => {
  const p = policy();
  const r = measured(119904, { lastDelta: 500 });
  assert.equal(adviseContext(r, p).action, 'none');
});

test('adviseContext asks before a narrow autocompact window is reached, not only before the policy default', () => {
  const p = policy();
  const ctx = { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' } };
  const { checkpointAt, compactAt } = thresholds(null, p, ctx);
  assert.equal(adviseContext(measured(90000), p, {}).action, 'none', 'below the 150k default, no window given');
  assert.equal(adviseContext(measured(95000, { lastDelta: 5000 }), p, ctx).action, 'compact', '95k is over the 100k window\'s own compact line');
  assert.equal(adviseContext(measured(82000, { lastDelta: 39000 }), p, ctx).action, 'compact', '82k is also over that line');
  assert.ok(compactAt < p.context.compactAt && checkpointAt < p.context.checkpointAt);
});

test('resolveAutocompactWindow: the environment beats settings.json, which beats the policy default', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-settings-'));
  const settingsPath = join(dir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '190000' } }));
  assert.equal(resolveAutocompactWindow(p, {}), p.context.autocompactDefault, 'no env, no settings: the policy default');
  assert.equal(resolveAutocompactWindow(p, { settingsPath }), 190000, 'settings.json read when no env value');
  assert.equal(
    resolveAutocompactWindow(p, { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '210000' }, settingsPath }),
    210000,
    'the environment wins over settings.json',
  );
  // Order does not matter: settings.json is only consulted once the env is checked and found empty.
  assert.equal(
    resolveAutocompactWindow(p, { settingsPath, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '210000' } }),
    210000,
  );
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

test('with no checkpoint, the checkpoint notice asks for one and names the path; with one, it does not', () => {
  const p = policy();
  const home = mkdtempSync(join(tmpdir(), 'orch-adv-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'context');
  const session = '0b7e5f1c-3a2d-4c8e-9f10-1234567890ab';
  const { checkpointAt } = thresholds(null, p);
  const r = measured(checkpointAt, { compaction: { uuid: 'e1d2c3b4-a5f6-4789-8abc-def012345678', at: new Date(Date.now() - 60000).toISOString() }, compactions: 3 });
  const ctx = { policy: p, session, dir, home, editCounter: 123 };
  const ask = contextNotice(r, adviseContext(r, p), ctx);
  assert.match(ask, /write the checkpoint now \(goal, decisions, files changed, verification, next action\) to /);
  const path = checkpointPath(session, r, dir);
  assert.ok(ask.endsWith(`to ${path}`), 'the ask carries the absolute path the plugin reads, not a ~/ form');
  assert.ok(!ask.includes('~/'), 'no ~/ form');
  assert.ok(Buffer.byteLength(ask) < 700, `under 700 B, got ${Buffer.byteLength(ask)}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'goal: x\n');
  const has = contextNotice(r, adviseContext(r, p), ctx);
  assert.doesNotMatch(has, /write the checkpoint/);
  assert.match(has, /newest checkpoint: /);
});

test('at the compact line with no checkpoint, one clause says compaction will summarise without one', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const { compactAt } = thresholds(null, p);
  const r = measured(compactAt);
  const text = contextNotice(r, adviseContext(r, p), { policy: p, session: 's1', dir, plansDir: dir });
  assert.match(text, / · compaction will summarise without a checkpoint$/);
  assert.doesNotMatch(text, /write the checkpoint/);
  assert.ok(Buffer.byteLength(text) < 400);
});

test('the post-compaction ask fires on a measured reading, not only a provisional one, and is keyed on the compaction count', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  // A measured reading (a response already landed) right after the boundary,
  // never asked about before: still an ask, unlike the old
  // `responsesSinceCompaction === 0` check, which only a provisional reading
  // (or a sample that lands before the first response) could satisfy.
  const r = measured(1000, { compaction: { uuid: 'e9', at: now() }, responsesSinceCompaction: 3, compactions: 1 });
  const advice = adviseContext(r, p);
  assert.equal(advice.action, 'none');
  assert.equal(postCompactionAskDue(r, advice, { dir }), true);
  const notice = contextNotice(r, advice, { policy: p, session: 's1', dir });
  assert.match(notice, /just summarised/);
  // Already asked about this compaction: no second ask for the same count.
  assert.equal(postCompactionAskDue(r, advice, { dir, askedAfterCompactions: 1 }), false);
  assert.doesNotMatch(contextNotice(r, advice, { policy: p, session: 's1', dir, askedAfterCompactions: 1 }), /just summarised/);
  // A second compaction (count 2) asks again even though it was asked before.
  const r2 = measured(1000, { compaction: { uuid: 'e10', at: now() }, responsesSinceCompaction: 1, compactions: 2 });
  assert.equal(postCompactionAskDue(r2, adviseContext(r2, p), { dir, askedAfterCompactions: 1 }), true);
});

test('the post-compaction ask never fires when a checkpoint already exists for the epoch', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const r = measured(1000, { compaction: { uuid: 'e11', at: now() }, responsesSinceCompaction: 0, compactions: 1 });
  const path = checkpointPath('s1', r, dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'goal: x\n');
  assert.equal(postCompactionAskDue(r, adviseContext(r, p), { dir, session: 's1' }), false);
  assert.doesNotMatch(contextNotice(r, adviseContext(r, p), { policy: p, session: 's1', dir }), /just summarised/);
});

test('a checkpoint beside the transcript folder is reported as outside the plugin folder, with where to move it', () => {
  const p = policy();
  const home = mkdtempSync(join(tmpdir(), 'orch-adv-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'context');
  const session = '0b7e5f1c-3a2d-4c8e-9f10-1234567890ab';
  const transcript = join(home, '.claude', 'projects', 'proj', `${session}.jsonl`);
  const { checkpointAt } = thresholds(null, p);
  const r = measured(checkpointAt, { transcript });
  const want = checkpointPath(session, r, dir);
  const wrong = join(dirname(transcript), 'orchestrate', 'context', session, `checkpoint-${session}.md`);
  mkdirSync(dirname(wrong), { recursive: true });
  writeFileSync(wrong, 'goal: x\n');
  const text = contextNotice(r, adviseContext(r, p), { policy: p, session, dir });
  assert.doesNotMatch(text, /newest checkpoint: none$|newest checkpoint: none ·/);
  assert.ok(text.includes(`one is at ${wrong}`), 'names where it is');
  assert.ok(text.includes(`move it to ${want}`), 'names where to move it');
  assert.match(text, /outside it/);
  assert.equal(hasCheckpoint(session, r, { dir }), false, 'still not a checkpoint the plugin reads');
});

test('the size line prints only the host-reported window and never promises the host autocompact point', () => {
  const p = policy();
  const dir = mkdtempSync(join(tmpdir(), 'orch-adv-'));
  const env = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' };
  const tick = r => contextTick(r, p, { policy: p, dir, env }).text;
  // Host says 180k; the setting says 100k: one source, the host's, and no second figure.
  const known = tick(measured(140000, { capacity: 180000 }));
  assert.match(known, / of ~180k/);
  assert.doesNotMatch(known, /autocompact|~100k/);
  const between = tick(measured(150000, { capacity: 180000 }));
  assert.doesNotMatch(between, /next:/, 'past the compact line, no figure is promised for the host');
  // Host says nothing: no window is printed, neither the setting nor a default.
  const unknown = tick(measured(60000));
  assert.doesNotMatch(unknown, / of ~/);
  assert.doesNotMatch(unknown, /autocompact/);
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
