// lib/prices.mjs — what a dispatch costs, in the unit the host itself uses.
//
// Claude Code's `/usage` computes the Session block's dollar figure locally from
// token counts at list price. So list-price dollars are not an invention here;
// they are the number the user can already see. They are NOT what a
// subscription is billed, and nothing here converts one to the other: a
// "share of your week" needs a weekly dollar figure nobody has measured, and
// the one that used to be here rested on a single observation.
//
// A price tag is a forecast said once, before the spend, never a running total.
//
// Pure functions, no I/O except the profile object a caller passes in.

import { shortModel } from './tier.mjs';

// Per million tokens (https://claude.com/pricing, checked 2026-09-24). A
// 5-minute cache write is 125% of input. Cache read is 10% of input, except
// Fable 5.1 at 2.5% and Opus 5.5 at 5%. How a 1-hour cache write lands on
// plan usage is undocumented, so it is priced as a 5-minute one and the
// number is a floor.
// `opus` here is the current `opus` alias, Opus 5.5 ($4/$20) — not the legacy
// Opus 5 ($5/$25).
export const PRICES = {
  fable: { in: 10, out: 50 },
  opus: { in: 4, out: 20 },
  sonnet: { in: 2, out: 10 },
  haiku: { in: 1, out: 5 },
};
export const PRICES_AS_OF = '2026-09-24';
export const PRICES_SOURCE = 'https://claude.com/pricing';
export const checked = '2026-09-24';

// One sentence, said once wherever a dollar figure is printed to the model,
// so it never reads as a bill: every number here comes from per-token list
// prices, and a subscription plan can charge something else entirely.
export function costLabel() {
  return 'modelled from list prices; your plan may bill differently';
}

export function cacheReadShare(modelId) {
  const s = String(modelId || '');
  if (/fable-5[-.]1/i.test(s)) return 0.025;
  if (/opus/i.test(s)) return 0.05;
  return 0.1;
}

// The family a model id belongs to, or null when it is not one of the four.
// It used to answer `sonnet` for anything it did not recognise, so a dispatch
// that named no model at all — an inherited one — was priced as the cheap
// model and reported as a measurement. Unknown stays unknown.
export function family(modelId) {
  const f = shortModel(modelId);
  return PRICES[f] ? f : null;
}

// One name per role, whatever the install path calls it. A plugin install
// dispatches `orchestrate:orch-planner`, the ledger used to file it as
// `orchestrate_orch-planner`, and the price table says `orch-planner`, so no
// lookup ever matched and the budget gate never fired on a plugin install.
export function normalizeRole(role) {
  return String(role || '').replace(/^[A-Za-z0-9-]+[:_](?=orch-)/, '');
}

// List-price dollars for a usage total, or null when the model is unknown.
export function dollars({ input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}, model = '') {
  const f = family(model);
  if (!f) return null;
  const p = PRICES[f];
  const m = 1e6;
  return (input * p.in + output * p.out + cacheRead * p.in * cacheReadShare(model) + cacheWrite * p.in * 1.25) / m;
}

// List-price dollars for advisorTotals() rows, each at its own model's rate.
// A row whose model nobody can price adds nothing and is counted in `unpriced`.
export function advisorDollars(rows) {
  let total = 0, unpriced = 0;
  for (const b of rows || []) {
    const d = dollars(b, b.model || '');
    if (d == null) unpriced += b.calls; else total += d;
  }
  return { dollars: total, unpriced };
}

// Plain report lines, one per advisor model, or null when it was never called.
export function advisorLine(rows) {
  if (!rows || !rows.length) return null;
  const k = n => `${Math.round(n / 1000)}k`;
  return rows.map(b => {
    const d = dollars(b, b.model || '');
    return `advisor: ${b.calls} call${b.calls === 1 ? '' : 's'}, ${k(b.input + b.cacheRead + b.cacheWrite)} read, ${k(b.output)} written, ${d == null ? `not priced (model ${b.model || 'unnamed'})` : `$${d.toFixed(2)} at list price on ${family(b.model)}`}`;
  }).join('\n');
}

// The starting table, for a role and model nobody has measured here yet. Every
// number is reasoned from the per-token prices above and one observed fan-out,
// and says so wherever it is printed.
export const REASONED = {
  'orch-researcher': { fable: 10, opus: 5, sonnet: 1.5 },
  'orch-planner': { fable: 8, opus: 4, sonnet: 1.2 },
  'orch-reviewer': { fable: 6, opus: 3, sonnet: 1 },
  'orch-implementer': { opus: 4, sonnet: 1.5 },
  'orch-debugger': { fable: 8, opus: 4, sonnet: 1.5 },
  'orch-browser': { opus: 3, sonnet: 1 },
  // About half a reviewer run: twelve read-only steps and a twenty-line return.
  'orch-advisor': { fable: 3, opus: 1.5, sonnet: 0.5 },
  // Fixed to opus in its own frontmatter, no cheaper model to fall back to.
  // models.md: "about 40 steps near 60k on Opus, roughly $1-2 list price per wave".
  'orch-coordinator': { opus: 1.5 },
  Explore: { haiku: 0.1, sonnet: 0.5 },
};
export const REASONED_AS_OF = '2026-09-09';

export function reasonedPrice(role, model) {
  const row = REASONED[normalizeRole(role)];
  if (!row) return null;
  const f = family(model);
  return f && row[f] != null ? row[f] : null;
}

// One dollar figure for a dispatch about to happen: the measured average for
// this role and model on this machine when there is one, else the reasoned
// table, else null when the model is unknown. The spend gate uses it to decide
// whether this dispatch would cross the run's budget ceiling.
export function estimateDollars(role, model, rows) {
  const f = family(model);
  if (!f) return null;
  const mine = measuredRows(role, f, rows);
  if (mine.length) return mine.reduce((a, r) => a + Number(r.dollars), 0) / mine.length;
  return reasonedPrice(role, model);
}

// The rows that count as a measurement of this role on this model family: a
// helper that ran spent tokens, so a row priced at $0 is a stop hook that saw
// no usage (a helper that died at its cap, a transcript it could not read),
// not a cheap run. Averaging those in would drag the mean to nothing and
// switch the run ceiling off after two empty returns. A row whose advisor could
// not be priced holds only part of what the helper spent, so it is left out too.
function measuredRows(role, fam, rows) {
  return (rows || []).filter(r => r && r.agent && normalizeRole(r.role) === normalizeRole(role) && family(r.model) === fam && r.dollars != null && Number.isFinite(Number(r.dollars)) && Number(r.dollars) > 0 && !(Number(r.advisorUnpriced) > 0));
}

// The dollar figure a price tag would print, plus whether it was measured
// here or reasoned — split out of priceTag so priceTagPair can reuse the same
// number instead of re-parsing the sentence.
function figureFor(role, model, rows) {
  const f = family(model);
  if (!f) return null;
  const mine = measuredRows(role, f, rows);
  if (mine.length) return { amount: mine.reduce((a, r) => a + Number(r.dollars), 0) / mine.length, measured: true, n: mine.length };
  const guess = reasonedPrice(role, model);
  return guess == null ? null : { amount: guess, measured: false };
}

// A price tag: measured from this machine's own past runs when there are any,
// and labelled as reasoned when there are not. `rows` is the parsed contents of
// costs.jsonl. `tier` and `profile` are accepted so callers need not know
// whether this release divides by a weekly figure; it does not.
export function priceTag(role, model, rows, tier, profile) {
  const f = family(model);
  if (!f) return `price tag: ${role} on an unnamed model — not priced, because nothing here knows which model it will run on`;
  const fig = figureFor(role, model, rows);
  if (!fig) return `price tag: ${role} on ${f} — no figure yet, measured or reasoned`;
  return fig.measured
    ? `price tag: ${role} on ${f} ≈ $${fig.amount.toFixed(2)} at list price, not subscription usage (measured here, n=${fig.n})`
    : `price tag: ${role} on ${f} ≈ $${fig.amount.toFixed(2)} at list price, not subscription usage (reasoned ${REASONED_AS_OF}, not yet measured here)`;
}

// 2.6: the low end of "2.6-2.7x", what five live rounds measured the helper
// path costing against a solo build of the same small app
// (docs/audits/2026-09-28-scoresheet-r9.md finding 5, citing
// docs/audits/2026-09-26-live-runs-r4.md through
// docs/audits/2026-09-28-live-runs-r9.md; the solo baseline is round 7's
// $0.69, docs/audits/2026-09-27-live-runs-r7.md). The low end is used so the
// printed solo figure is never smaller than what was actually measured.
export const SOLO_RATIO = 2.6;

// The price tag with a second figure: the same build done solo in this chat,
// = the helper figure / SOLO_RATIO, rounded to the nearest 10 cents. Facts
// only, no instruction — the card (lib/card.mjs) already tells the lead what
// to do with the pair. Known limit: this fires on the dispatch itself, which
// is after the lead already chose to split; the card's sentence is what fires
// before that choice.
export function priceTagPair(role, model, rows, tier, profile) {
  const tag = priceTag(role, model, rows, tier, profile);
  const fig = figureFor(role, model, rows);
  if (!fig) return tag;
  const solo = Math.round((fig.amount / SOLO_RATIO) * 10) / 10;
  return `${tag}; ≈ $${solo.toFixed(2)} done in this chat (measured ratio over five live rounds)`;
}
