// lib/spend-gate.mjs — the price tag and the budget-ceiling gate, split out of
// guard-agent.mjs. No network, no child processes.

import { priceTag, priceTagPair, estimateDollars, normalizeRole } from './prices.mjs';
import { sessionRun, findRepoRoot, runsUnder, openRunsUnder, activeRunPointer } from './tier.mjs';
import { readCosts } from '../ledger.mjs';
import { roleModel } from './workers.mjs';

// The model a dispatch will actually run on: the one it named, or — when it
// named none — the model the role's own agent file names (assets/agents/
// <role>.md). general-purpose, claude, Explore and Plan have no such file and
// stay unnamed, the same 'inherit' as before: they run on whatever the
// session was on, which nothing here can price. Each orch-* role's model is
// its own, known whether or not the dispatch said so.
export function effectiveModel(ti) {
  const named = String((ti && ti.model) || '');
  if (named) return named;
  return roleModel(normalizeRole(ti && ti.subagent_type)) || '';
}

// A price, said once, before the spend. Measured from this machine's own past
// runs when there are any; labelled reasoned when there are not; absent when
// neither exists, including when the packet named no model at all.
//
// It carries NO `permissionDecision`. `allow` alongside `additionalContext` is
// documented and would work, and it would also auto-approve every dispatch and
// take away the user's permission prompt — a silent change to a default nobody
// asked to change.
// `pair`: true only for the first orch-implementer dispatch of a session with
// no run ledger open (guard-agent.mjs decides that; this just prints the
// extra figure when told to). `rows`: the cost history, when the caller has
// already read it. The plan and the profile are not read: the tag does not
// use them, and reading the plan parses ~/.claude.json, which can be megabytes.
export function tagFor(ti, { pair = false, rows = null } = {}) {
  try {
    const role = String(ti.subagent_type || 'claude');
    const model = effectiveModel(ti);
    if (!model) return '';
    const r = rows || readCosts();
    return pair ? priceTagPair(role, model, r) : priceTag(role, model, r);
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

// Would this dispatch push the run past its budget ceiling? Priced on the model
// it will actually run on (effectiveModel): an orch-* role that names none runs
// on its own file's model, and skipping it let a builder or a coordinator past
// a ceiling a named one was refused at. Null when there is nothing to gate on:
// no run resolved, no ceiling set, or a dispatch that fits under it. A dispatch
// nobody can price (a role or model with no figure) is refused only once the
// run has already reached its ceiling, since then any helper crosses it.
// Otherwise the numbers the deny reason needs; `est` is null when unpriced.
export function budgetDecision(input, ti, run = resolveRunObj(input, ti, { forBudget: true }), rows = null) {
  if (!run || !run.budget || run.budget.ceiling == null) return null;
  const model = effectiveModel(ti);
  const est = model ? estimateDollars(String(ti.subagent_type || 'claude'), model, rows || readCosts()) : null;
  const already = Number(run.spend) || 0;
  if (est == null) {
    return already >= run.budget.ceiling
      ? { runId: run.runId, model, already: round2(already), est: null, total: round2(already), ceiling: run.budget.ceiling }
      : null;
  }
  const over = overCeiling(already, est, run.budget.ceiling);
  return over ? { runId: run.runId, model, ...over } : null;
}
