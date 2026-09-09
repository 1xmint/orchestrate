// lib/prices.mjs — what a dispatch costs, in the unit the host itself uses.
//
// Claude Code's `/usage` computes the Session block's dollar figure locally from
// token counts at list price. So list-price dollars are not an invention here;
// they are the number the user can already see, and the only unit in which a
// subscription dispatch can be priced at all.
//
// A price tag is a forecast said once, before the spend. It is deliberately not
// a running counter: a counter reads as an allowance and invites spending up to
// it, which is the reasoning that removed the Fable cap in v0.5.0.
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

export function family(modelId) {
  const f = shortModel(modelId);
  return PRICES[f] ? f : 'sonnet';
}

export function dollars({ input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}, model = 'sonnet') {
  const p = PRICES[family(model)];
  const m = 1e6;
  return (input * p.in + output * p.out + cacheRead * p.in * 0.1 + cacheWrite * p.in * 1.25) / m;
}

// List-price dollars in one week of a plan's usage. One observation, made
// 2026-09-09: three Fable researchers read 20.5M + 9.0M + 7.3M mostly-cached
// input tokens, which prices at roughly $36, and Josh reported that fan-out as
// about a quarter of a Max 5x week. Everything else is that number scaled by
// what the plans cost. Low confidence, and it is why `--set week=<dollars>`
// exists: one real measurement should replace this.
export const WEEK = { pro: 30, max5: 150, max20: 600, team: 30, api: null };
export const WEEK_SOURCE = 'one observation, 2026-09-09; calibrate with `profile.mjs --set week=<dollars>`';

export function weekDollars(tier, profile) {
  const set = profile && Number(profile.weekDollars);
  if (Number.isFinite(set) && set > 0) return { value: set, source: `set by the user ${String(profile.weekSetAt || '').slice(0, 10)}` };
  const w = WEEK[tier];
  return w ? { value: w, source: WEEK_SOURCE } : { value: null, source: 'no anchor for this plan' };
}

// The share of a week a spend is, as a sentence fragment, or nothing when there
// is no anchor to divide by. Never guess a denominator: a made-up percentage is
// worse than no percentage.
export function share(amount, tier, profile) {
  const w = weekDollars(tier, profile);
  if (!w.value) return null;
  return (Number(amount) / w.value) * 100;
}

// The percentage always travels with what its denominator rests on. Printing a
// share of a week against a number nobody measured, with no label, is the exact
// shape of confident-and-unfounded this release exists to stop — and the label
// lived only in `weekDollars`, which nothing printed.
export function weekShare(amount, tier, profile) {
  const s = share(amount, tier, profile);
  if (s == null) return '';
  const w = weekDollars(tier, profile);
  const basis = /^set by the user/.test(w.source) ? 'your own figure' : 'one observation; `--set week=<dollars>` to correct it';
  return `, about ${s < 1 ? '<1' : s.toFixed(0)}% of a ${tier} week (${basis})`;
}

// The starting table, for a role and model nobody has measured here yet. Every
// number is reasoned from the observation above and the per-token prices, and
// says so wherever it is printed.
export const REASONED = {
  'orch-researcher': { fable: 10, opus: 5, sonnet: 1.5 },
  'orch-planner': { fable: 8, opus: 4, sonnet: 1.2 },
  'orch-reviewer': { fable: 6, opus: 3, sonnet: 1 },
  'orch-implementer': { opus: 4, sonnet: 1.5 },
  'orch-debugger': { fable: 8, opus: 4, sonnet: 1.5 },
  'orch-browser': { opus: 3, sonnet: 1 },
  Explore: { haiku: 0.1, sonnet: 0.5 },
};

export function reasonedPrice(role, model) {
  const row = REASONED[role];
  if (!row) return null;
  const f = family(model);
  return row[f] != null ? row[f] : null;
}

// A price tag: measured from this machine's own past runs when there are any,
// and labelled as reasoned when there are not. `rows` is the parsed contents of
// costs.jsonl.
export function priceTag(role, model, rows, tier, profile) {
  const f = family(model);
  const mine = (rows || []).filter(r => r && r.role === role && family(r.model) === f && Number.isFinite(Number(r.dollars)));
  if (mine.length) {
    const avg = mine.reduce((a, r) => a + Number(r.dollars), 0) / mine.length;
    return `price tag: ${role} on ${f} ≈ $${avg.toFixed(2)} at list price (measured here, n=${mine.length})${weekShare(avg, tier, profile)}`;
  }
  const guess = reasonedPrice(role, model);
  if (guess == null) return `price tag: ${role} on ${f} — no figure yet, measured or reasoned`;
  return `price tag: ${role} on ${f} ≈ $${guess.toFixed(2)} at list price (reasoned, not yet measured here)${weekShare(guess, tier, profile)}`;
}
