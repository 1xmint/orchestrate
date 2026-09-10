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

// Per million tokens, from references/models.md (cached 2026-06-24). Cache read
// is 10% of input; a 5-minute cache write is 125% of input. How a 1-hour cache
// write lands on plan usage is undocumented, so it is priced as a 5-minute one
// and the number is a floor, not a bound.
export const PRICES = {
  fable: { in: 10, out: 50 },
  opus: { in: 5, out: 25 },
  sonnet: { in: 2, out: 10 },
  haiku: { in: 1, out: 5 },
};
export const PRICES_AS_OF = '2026-06-24';

// The family a model id belongs to, or null when it is not one of the four.
// It used to answer `sonnet` for anything it did not recognise, so a dispatch
// that named no model at all — an inherited one — was priced as the cheap
// model and reported as a measurement. Unknown stays unknown.
export function family(modelId) {
  const f = shortModel(modelId);
  return PRICES[f] ? f : null;
}

// List-price dollars for a usage total, or null when the model is unknown.
export function dollars({ input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}, model = '') {
  const f = family(model);
  if (!f) return null;
  const p = PRICES[f];
  const m = 1e6;
  return (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / m;
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
  Explore: { haiku: 0.1, sonnet: 0.5 },
};
export const REASONED_AS_OF = '2026-09-09';

export function reasonedPrice(role, model) {
  const row = REASONED[role];
  if (!row) return null;
  const f = family(model);
  return f && row[f] != null ? row[f] : null;
}

// A price tag: measured from this machine's own past runs when there are any,
// and labelled as reasoned when there are not. `rows` is the parsed contents of
// costs.jsonl. `tier` and `profile` are accepted so callers need not know
// whether this release divides by a weekly figure; it does not.
export function priceTag(role, model, rows, tier, profile) {
  const f = family(model);
  if (!f) return `price tag: ${role} on an unnamed model — not priced, because nothing here knows which model it will run on`;
  const mine = (rows || []).filter(r => r && r.role === role && family(r.model) === f && Number.isFinite(Number(r.dollars)));
  if (mine.length) {
    const avg = mine.reduce((a, r) => a + Number(r.dollars), 0) / mine.length;
    return `price tag: ${role} on ${f} ≈ $${avg.toFixed(2)} at list price, not subscription usage (measured here, n=${mine.length})`;
  }
  const guess = reasonedPrice(role, model);
  if (guess == null) return `price tag: ${role} on ${f} — no figure yet, measured or reasoned`;
  return `price tag: ${role} on ${f} ≈ $${guess.toFixed(2)} at list price, not subscription usage (reasoned ${REASONED_AS_OF}, not yet measured here)`;
}
