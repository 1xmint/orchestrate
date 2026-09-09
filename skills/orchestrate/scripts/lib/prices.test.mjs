// prices.test.mjs — the arithmetic behind a price tag, and the rule that a
// missing anchor prints nothing rather than a made-up percentage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dollars, family, share, weekShare, priceTag, weekDollars, PRICES, REASONED } from './prices.mjs';

test('a known usage prices to a hand-computed figure', () => {
  // 1M fresh input at $5, 1M output at $25, 1M cache read at $0.50,
  // 1M cache write at $6.25 = $36.75 on Opus.
  const d = dollars({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, 'opus');
  assert.equal(Number(d.toFixed(2)), 36.75);
  // Sonnet is 2/10, so the same usage is 2/5 of Opus on input and output.
  assert.equal(Number(dollars({ input: 1e6 }, 'sonnet').toFixed(2)), 2);
  assert.equal(dollars({}, 'opus'), 0, 'no tokens, no dollars');
});

test('the family comes from the model id, and an unknown one does not throw', () => {
  assert.equal(family('claude-opus-5'), 'opus');
  assert.equal(family('claude-fable-5-1'), 'fable');
  assert.equal(family('inherit'), 'sonnet', 'an unnamed model is priced as the default worker');
  for (const p of Object.values(PRICES)) assert.ok(p.in > 0 && p.out > p.in);
});

test('a share needs an anchor, and says nothing without one', () => {
  assert.equal(Math.round(share(15, 'max5', null)), 10, '$15 of a $150 week');
  assert.equal(share(15, 'api', null), null, 'per-token billing has no week');
  assert.match(weekShare(15, 'max5', null), /about 10% of a max5 week/);
  assert.equal(weekShare(15, 'api', null), '', 'no anchor, no percentage');
  // The user's own measurement beats the one observation behind the default.
  const w = weekDollars('max5', { weekDollars: 400, weekSetAt: '2026-09-09T00:00:00Z' });
  assert.equal(w.value, 400);
  assert.match(w.source, /set by the user 2026-09-09/);
});

test('a price tag is measured when there is anything to measure, reasoned when there is not', () => {
  const none = priceTag('orch-researcher', 'fable', [], 'max5', null);
  assert.match(none, /reasoned, not yet measured here/);
  assert.match(none, /≈ \$10\.00/);

  const rows = [
    { role: 'orch-researcher', model: 'claude-fable-5-1', dollars: 9.0 },
    { role: 'orch-researcher', model: 'fable', dollars: 9.4 },
    { role: 'orch-implementer', model: 'sonnet', dollars: 1.1 },
  ];
  const tag = priceTag('orch-researcher', 'fable', rows, 'max5', null);
  assert.match(tag, /≈ \$9\.20 at list price \(measured here, n=2\)/);
  assert.match(tag, /about 6% of a max5 week/);
  assert.doesNotMatch(tag, /reasoned/, 'measured beats reasoned');

  // A role nobody priced says so rather than inventing a number.
  assert.match(priceTag('mystery-role', 'opus', [], 'max5', null), /no figure yet/);
});

test('every reasoned row is ordered by what the model costs', () => {
  for (const [role, row] of Object.entries(REASONED)) {
    const fams = Object.keys(row);
    for (const a of fams) for (const b of fams) {
      if (PRICES[a].in > PRICES[b].in) assert.ok(row[a] >= row[b], `${role}: ${a} should not be cheaper than ${b}`);
    }
  }
});
