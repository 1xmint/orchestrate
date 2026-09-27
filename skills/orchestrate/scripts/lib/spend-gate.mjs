// lib/spend-gate.mjs — the price tag and the budget-ceiling gate, split out of
// guard-agent.mjs. No network, no child processes.

import { priceTag, estimateDollars } from './prices.mjs';
import { readJson, detectTier, PROFILE_PATH, sessionRun, findRepoRoot, runsUnder, openRunsUnder, activeRunPointer } from './tier.mjs';
import { readCosts } from '../ledger.mjs';

// A price, said once, before the spend. Measured from this machine's own past
// runs when there are any; labelled reasoned when there are not; absent when
// neither exists, including when the packet named no model at all.
//
// It carries NO `permissionDecision`. `allow` alongside `additionalContext` is
// documented and would work, and it would also auto-approve every dispatch and
// take away the user's permission prompt — a silent change to a default nobody
// asked to change.
export function tagFor(ti) {
  try {
    const role = String(ti.subagent_type || 'claude');
    const model = String(ti.model || '');
    if (!model) return '';
    return priceTag(role, model, readCosts(), detectTier().tier, readJson(PROFILE_PATH));
  } catch { return ''; }
}

// The run this packet belongs to: the `RUN:` line a coordinated packet carries,
// or the run this session is bound to. The ledger resolves a return from this,
// rather than from whichever run on the machine happens to be newest.
export function runFor(input, ti) {
  const named = (/^\s*RUN:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1];
  if (named) return named;
  const bound = sessionRun(input.session_id);
  return bound ? bound.runId : null;
}

const round2 = n => Math.round(Number(n) * 100) / 100;

// The run object this dispatch bills against, so the gate can read its budget
// ceiling and spend so far. Resolved the way a return is: the session binding
// first, then a run named in the packet or the one open run in the repo, then
// the machine's last-opened run as a hint for a session working above its repo.
// This is a read, never a write, so the last-opened hint is allowed here where
// it is refused for filing a return — *except* for the budget gate, whose
// caller passes `forBudget: true`. The pointer names whichever run was opened
// last on this whole machine, which can belong to a repo this dispatch has
// nothing to do with; enforcing its ceiling denied dispatches against a
// stranger repo's budget. Everywhere the pointer is shown rather than
// enforced (`router.mjs`'s "candidate, not bound") already hedges it; the gate
// is the one caller that would otherwise have treated it as authoritative.
export function resolveRunObj(input, ti, { forBudget = false } = {}) {
  const bound = sessionRun(input.session_id);
  if (bound) return bound;
  const named = (/^\s*RUN:\s*(\S+)/m.exec(String(ti.prompt || '')) || [])[1];
  const root = findRepoRoot(input.cwd);
  if (root) {
    if (named) { const hit = runsUnder(root).find(r => r.runId === named); if (hit) return hit; }
    const open = openRunsUnder(root);
    if (open.length === 1) return open[0];
  }
  if (forBudget) return null;
  return activeRunPointer();
}

// The pure arithmetic of the gate, so it can be tested without a machine's cost
// history: does spend-so-far plus this dispatch cross the ceiling? Null when
// there is nothing to decide (no ceiling, or no price for this dispatch).
export function overCeiling(already, est, ceiling) {
  if (ceiling == null || est == null) return null;
  const total = (Number(already) || 0) + Number(est);
  return total > ceiling
    ? { already: round2(Number(already) || 0), est: round2(Number(est)), total: round2(total), ceiling }
    : null;
}

// Would this dispatch push the run past its budget ceiling? Null when there is
// nothing to gate on: no model named (so no price), no run resolved, or no
// ceiling set. Otherwise the numbers the deny reason needs.
export function budgetDecision(input, ti, run = resolveRunObj(input, ti, { forBudget: true })) {
  const model = String(ti.model || '');
  if (!model) return null;
  if (!run || !run.budget || run.budget.ceiling == null) return null;
  const est = estimateDollars(String(ti.subagent_type || 'claude'), model, readCosts());
  const over = overCeiling(Number(run.spend) || 0, est, run.budget.ceiling);
  return over ? { runId: run.runId, ...over } : null;
}
