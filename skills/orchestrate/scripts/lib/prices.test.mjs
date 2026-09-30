// prices.test.mjs — the arithmetic behind a price tag, and the two things it
// refuses to invent: a figure for a model nobody named, and a percentage of a
// subscription week nobody measured.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dollars, family, priceTag, priceTagPair, SOLO_RATIO, reasonedPrice, estimateDollars, PRICES, REASONED, PRICES_AS_OF, checked, costLabel, cacheReadShare } from './prices.mjs';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prices.mjs'), 'utf8');

test('a known usage prices to a hand-computed figure', () => {
  // Opus 5.5 ($4/$20): 1M fresh input at $4, 1M output at $20, 1M cache
  // read at $0.20 (5% of input), 1M cache write at $5 (125% of input) =
  // $29.20.
  const d = dollars({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, 'opus');
  assert.equal(Number(d.toFixed(2)), 29.2);
  // Sonnet is 2/10, so the same usage is half of Opus on input and output.
  assert.equal(Number(dollars({ input: 1e6 }, 'sonnet').toFixed(2)), 2);
  assert.equal(dollars({}, 'opus'), 0, 'no tokens, no dollars');
});

test('opus prices to the current opus alias, Opus 5.5, and the check date is current', () => {
  assert.equal(PRICES.opus.in, 4);
  assert.equal(PRICES.opus.out, 20);
  assert.equal(checked, '2026-09-24');
  assert.equal(PRICES_AS_OF, '2026-09-24');
  assert.match(SOURCE, /https:\/\/claude\.com\/pricing/);
});

test('cacheReadShare: opus is 5%, fable 5.1 is 2.5%, everything else is 10%', () => {
  assert.equal(cacheReadShare('claude-opus-5-5'), 0.05);
  assert.equal(cacheReadShare('claude-fable-5-1'), 0.025);
  assert.equal(cacheReadShare('claude-sonnet-5'), 0.1);
  assert.equal(cacheReadShare('claude-haiku-4-5'), 0.1);
  assert.equal(cacheReadShare(''), 0.1);
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
    { agent: 'a1', role: 'orch-researcher', model: 'claude-fable-5-1', dollars: 9.0 },
    { agent: 'a2', role: 'orchestrate_orch-researcher', model: 'fable', dollars: 9.4 },
    { role: 'orch-researcher', model: 'fable', dollars: 40, note: 'written before the meter counted each call once, so not a measurement' },
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

test('orch-coordinator has a reasoned row, priced on opus, its only model', () => {
  // orch-coordinator.md pins model: opus with no cheaper fallback, so the
  // reasoned table has no fable or sonnet figure to omit by mistake.
  assert.ok(REASONED['orch-coordinator'], 'orch-coordinator is missing from REASONED');
  assert.deepEqual(Object.keys(REASONED['orch-coordinator']), ['opus']);
  assert.equal(reasonedPrice('orch-coordinator', 'opus'), 1.5);
});

test('costLabel says the figure is modelled from list prices, not a bill', () => {
  assert.equal(costLabel(), 'modelled from list prices; your plan may bill differently');
});

test('every reasoned row is ordered by what the model costs', () => {
  for (const [role, row] of Object.entries(REASONED)) {
    const fams = Object.keys(row);
    for (const a of fams) for (const b of fams) {
      if (PRICES[a].in > PRICES[b].in) assert.ok(row[a] >= row[b], `${role}: ${a} should not be cheaper than ${b}`);
    }
  }
});

test("a row priced at $0 is not a measurement: it never lowers the mean or switches the ceiling off", () => {
  // Round-5 audit finding 1 (docs/audits/2026-09-26-scoresheet-r5.md): two
  // returns that carried no usage were averaged in, the tag read "≈ $0.00
  // (measured here, n=2)", and a dispatch that should have crossed the run
  // ceiling went through. A helper that ran spent tokens; a $0 row is a stop
  // hook that saw nothing.
  const zeros = [
    { agent: "z1", role: "orch-implementer", model: "sonnet", dollars: 0 },
    { agent: "z2", role: "orch-implementer", model: "sonnet", dollars: 0 },
  ];
  assert.equal(estimateDollars("orch-implementer", "sonnet", zeros), REASONED["orch-implementer"].sonnet, "only empty rows: the reasoned figure stands");
  assert.match(priceTag("orch-implementer", "sonnet", zeros, "pro", null), /reasoned .*not yet measured here/);
  assert.doesNotMatch(priceTag("orch-implementer", "sonnet", zeros, "pro", null), /\$0\.00/);

  const mixed = [...zeros, { agent: "m1", role: "orch-implementer", model: "sonnet", dollars: 1.2 }, { agent: "m2", role: "orch-implementer", model: "sonnet", dollars: 0.8 }];
  assert.equal(estimateDollars("orch-implementer", "sonnet", mixed), 1.0, "the mean is over the rows that measured something");
  assert.match(priceTag("orch-implementer", "sonnet", mixed, "pro", null), /≈ \$1\.00 .*\(measured here, n=2\)/);
});

// ---- priceTagPair: the solo/helper pair (round-9 audit Part C item 3) -----

test('SOLO_RATIO is pinned at 2.6, the low end of five live rounds\' 2.6-2.7x', () => {
  assert.equal(SOLO_RATIO, 2.6);
});

test('priceTagPair appends the solo figure — the helper figure divided by SOLO_RATIO, rounded to the nearest dime', () => {
  // reasoned orch-implementer/sonnet is $1.50; 1.50 / 2.6 = 0.5769... -> $0.60.
  const tag = priceTagPair('orch-implementer', 'sonnet', [], 'pro', null);
  assert.match(tag, /price tag: orch-implementer on sonnet ≈ \$1\.50 at list price, not subscription usage \(reasoned/);
  assert.match(tag, /≈ \$0\.60 done in this chat \(measured ratio over five live rounds\)/);
});

test('priceTagPair uses the measured figure, not the reasoned one, when there is a measurement', () => {
  const rows = [{ agent: 'a1', role: 'orch-implementer', model: 'sonnet', dollars: 2.6 }];
  const tag = priceTagPair('orch-implementer', 'sonnet', rows, 'pro', null);
  assert.match(tag, /≈ \$2\.60 at list price.*measured here, n=1/);
  assert.match(tag, /≈ \$1\.00 done in this chat/);
});

test('priceTagPair falls back to the plain tag when there is no figure to pair (no model, or nothing priced)', () => {
  assert.equal(priceTagPair('orch-implementer', '', [], 'pro', null), priceTag('orch-implementer', '', [], 'pro', null));
  assert.doesNotMatch(priceTagPair('mystery-role', 'opus', [], 'pro', null), /done in this chat/);
});

test('a cost row whose advisor went unpriced is not averaged as a measurement', () => {
  const rows = [
    { agent: 'a1', role: 'orch-implementer', model: 'sonnet', dollars: 1.0 },
    { agent: 'a2', role: 'orch-implementer', model: 'sonnet', dollars: 0.01, advisorUnpriced: 1 },
  ];
  assert.equal(estimateDollars('orch-implementer', 'sonnet', rows), 1.0);
});
