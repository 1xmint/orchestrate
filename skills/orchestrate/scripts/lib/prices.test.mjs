// prices.test.mjs — the arithmetic behind a price tag, and the two things it
// refuses to invent: a figure for a model nobody named, and a percentage of a
// subscription week nobody measured.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dollars, family, priceTag, reasonedPrice, PRICES, REASONED } from './prices.mjs';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prices.mjs'), 'utf8');

test('a known usage prices to a hand-computed figure', () => {
  // 1M fresh input at $5, 1M output at $25, 1M cache read at $0.50,
  // 1M cache write at $6.25 = $36.75 on Opus.
  const d = dollars({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, 'opus');
  assert.equal(Number(d.toFixed(2)), 36.75);
  // Sonnet is 2/10, so the same usage is 2/5 of Opus on input and output.
  assert.equal(Number(dollars({ input: 1e6 }, 'sonnet').toFixed(2)), 2);
  assert.equal(dollars({}, 'opus'), 0, 'no tokens, no dollars');
});

test('an unnamed model has no family and no price', () => {
  assert.equal(family('claude-opus-5'), 'opus');
  assert.equal(family('claude-fable-5-1'), 'fable');
  // It used to answer `sonnet` for anything it did not recognise. So a dispatch
  // that named no model at all — one that inherits the session's — was priced
  // as the cheap model, and the figure was then reported as a measurement.
  assert.equal(family('inherit'), null);
  assert.equal(family(''), null);
  assert.equal(family(undefined), null);
  assert.equal(dollars({ input: 1e6 }, 'inherit'), null, 'unknown stays unknown');
  assert.equal(reasonedPrice('orch-researcher', 'inherit'), null);
  for (const p of Object.values(PRICES)) assert.ok(p.in > 0 && p.out > p.in);
});

test('nothing here converts list price into a share of a subscription week', () => {
  // The anchor it divided by — Pro $30, Max 5x $150, Max 20x $600 — came from a
  // single observation. A percentage computed from that reads like a
  // measurement and the reader cannot tell that it is not one.
  assert.doesNotMatch(SOURCE, /weekShare|weekDollars|export const WEEK\b/);
  const tag = priceTag('orch-researcher', 'fable', [], 'max5', { weekDollars: 150 });
  assert.doesNotMatch(tag, /% of/);
  assert.match(tag, /list price, not subscription usage/);
});

test('a price tag is measured when there is anything to measure, reasoned when there is not', () => {
  const none = priceTag('orch-researcher', 'fable', [], 'max5', null);
  assert.match(none, /reasoned 2026-09-09, not yet measured here/);
  assert.match(none, /≈ \$10\.00/);

  const rows = [
    { role: 'orch-researcher', model: 'claude-fable-5-1', dollars: 9.0 },
    { role: 'orch-researcher', model: 'fable', dollars: 9.4 },
    { role: 'orch-implementer', model: 'sonnet', dollars: 1.1 },
  ];
  const tag = priceTag('orch-researcher', 'fable', rows, 'max5', null);
  assert.match(tag, /≈ \$9\.20 at list price, not subscription usage \(measured here, n=2\)/);
  assert.doesNotMatch(tag, /reasoned/, 'measured beats reasoned');

  // A role nobody priced says so rather than inventing a number.
  assert.match(priceTag('mystery-role', 'opus', [], 'max5', null), /no figure yet/);
  // And a dispatch with no model gets no figure at all.
  assert.match(priceTag('orch-researcher', '', rows, 'max5', null), /not priced/);
});

test('every reasoned row is ordered by what the model costs', () => {
  for (const [role, row] of Object.entries(REASONED)) {
    const fams = Object.keys(row);
    for (const a of fams) for (const b of fams) {
      if (PRICES[a].in > PRICES[b].in) assert.ok(row[a] >= row[b], `${role}: ${a} should not be cheaper than ${b}`);
    }
  }
});
