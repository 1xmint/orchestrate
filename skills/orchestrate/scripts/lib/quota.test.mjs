// quota.test.mjs — the gates read from a live quota snapshot, pinned to the
// exported thresholds rather than to the numbers themselves, so a deliberate
// tune of one constant fails only the test that names it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotFrom, readQuota, HELPER_STOP_FIVE_HOUR, HELPER_STOP_WEEK, CAUTION_FIVE_HOUR, QUOTA_FRESH_MS } from './quota.mjs';
import { modelDecision } from '../guard-agent.mjs';
import { quotaBand } from '../router.mjs';

const pro = { tier: 'pro' };
const fiveHour = pct => snapshotFrom({ rate_limits: { five_hour: { used_percentage: pct } } });
const week = pct => snapshotFrom({ rate_limits: { seven_day: { used_percentage: pct } } });

test('the defaults are 80/90/60, on purpose: a tune of any of these is a one-line change here', () => {
  assert.equal(HELPER_STOP_FIVE_HOUR, 80);
  assert.equal(HELPER_STOP_WEEK, 90);
  assert.equal(CAUTION_FIVE_HOUR, 60);
});

test('a new helper is denied at the 5-hour stop line, not just under it', () => {
  const under = modelDecision({ subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'x' }, { ...pro, quota: fiveHour(HELPER_STOP_FIVE_HOUR - 1) });
  const at = modelDecision({ subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'x' }, { ...pro, quota: fiveHour(HELPER_STOP_FIVE_HOUR) });
  assert.equal(under, null);
  assert.equal(at.prefix, 'quota');
});

test('a new helper is denied at the weekly stop line, not just under it', () => {
  const under = modelDecision({ subagent_type: 'orch-planner', model: 'opus', prompt: 'x' }, { ...pro, quota: week(HELPER_STOP_WEEK - 1) });
  const at = modelDecision({ subagent_type: 'orch-planner', model: 'opus', prompt: 'x' }, { ...pro, quota: week(HELPER_STOP_WEEK) });
  assert.equal(under, null);
  assert.equal(at.prefix, 'quota');
});

test('the router names caution at its own line, not the stop line', () => {
  assert.equal(quotaBand(fiveHour(CAUTION_FIVE_HOUR - 1)), 'ok');
  assert.equal(quotaBand(fiveHour(CAUTION_FIVE_HOUR)), 'caution');
  assert.equal(quotaBand(fiveHour(HELPER_STOP_FIVE_HOUR)), 'stop');
});

test('a snapshot older than the freshness window reads as absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-quota-'));
  const p = join(dir, 'quota.json');
  const now = Date.now();
  writeFileSync(p, JSON.stringify(snapshotFrom({ rate_limits: { five_hour: { used_percentage: 50 } } }, now - QUOTA_FRESH_MS - 1, 'org-a')));
  assert.equal(readQuota(now, p, 'org-a'), null, 'just past the window is absent');
  writeFileSync(p, JSON.stringify(snapshotFrom({ rate_limits: { five_hour: { used_percentage: 50 } } }, now - QUOTA_FRESH_MS + 1, 'org-a')));
  assert.equal(readQuota(now, p, 'org-a').fiveHour.pct, 50, 'just inside the window is fresh');
});
