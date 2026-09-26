// lib/state-line.mjs — the full `router status` line and the pieces it is
// built from: model, tier, codex, limits, context band, quota band and the
// run's own readiness/budget/progress phrases. Split out because it is one
// coherent reading of "where things stand", built from other libs' state but
// owned by none of them.

import { AGENT_NAMES, DIR, readJson } from './tier.mjs';
import { loadPolicy } from './policy.mjs';
import { thresholds } from './context.mjs';
import { CAUTION_FIVE_HOUR, HELPER_STOP_FIVE_HOUR } from './quota.mjs';
import { join } from 'node:path';

const CODEX_STATUS_CACHE = join(DIR, 'workers', 'codex-status.json');

export function codexState(now = Date.now()) {
  const c = readJson(CODEX_STATUS_CACHE);
  // A newly learned quota stop wins over an older successful probe.  This is
  // read-only and never starts Codex from a hook.
  const provider = readJson(join(DIR, 'workers', 'provider-state.json')) || {};
  const exhausted = Array.isArray(provider.exhausted) && provider.exhausted.some(e => e && e.provider === 'codex' && e.resetsAt && Date.parse(e.resetsAt) > now);
  if (exhausted) return 'limit';
  if (!c || !c.at || now - Date.parse(c.at) > 3600000) return 'off';
  return c.status === 'limit' ? 'limit' : c.status === 'ok' ? 'ok' : 'off';
}

// ---- state ------------------------------------------------------------------
export function stateLine(ctx, prefix) {
  const you = ctx.self && ctx.self.model
    ? `you: ${ctx.self.model}${ctx.self.effort ? ` @ ${ctx.self.effort} effort` : ''}`
    : 'you: model not known here';
  const agents = `orch-agents ${ctx.agents}/${AGENT_NAMES.length}`;
  const limits = (ctx.limits.length ? `limits today: ${ctx.limits.join(', ')}` : 'limits today: none') + contextPhrase(ctx.context);
  return `${prefix} ${you} · tier ${ctx.tier} · ${agents} · codex: ${ctx.codex || codexState()} · ${runPhrase(ctx)} · ${limits}${quotaPhrase(ctx.quota)}${ctx.persist ? ' · auto-continue on' : ''}`;
}

// What `router status` prints on request. The full state line has no other
// home now — see actionableLine for what the card carries unasked.
export function statusReply(ctx) {
  return stateLine(ctx, '[orchestrate]');
}

// The one sentence the card (and a later "changed" line) carries unasked,
// only when something is actionable right now: a usage limit hit today, a run
// this session continues, or auto-continue armed. No counters, no model name,
// no tier word — the full picture is `router status`, read on demand.
// Checked in this order because a limit that refuses helpers is the most
// urgent of the three.
export function actionableLine(ctx) {
  if (ctx.limits && ctx.limits.length) {
    const names = ctx.limits.map(f => f.charAt(0).toUpperCase() + f.slice(1));
    const pronoun = names.length > 1 ? 'them' : 'it';
    return `Today's limit on ${names.join(', ')} is reached; helpers on ${pronoun} are refused until it resets.`;
  }
  if (ctx.run && ctx.run.runMd) return `This session continues the run at ${ctx.run.runMd}.`;
  if (ctx.persist) return 'Auto-continue is on; say "persist off" to stop it.';
  return '';
}

// One policy number decides each cut, read from lib/context.mjs's own
// thresholds() rather than a private copy: checkpointAt and compactAt (or a
// known smaller window's share of it) are the only two bands there are.
export function contextBand(reading, policy = loadPolicy()) {
  const n = reading && reading.tokens;
  if (!Number.isFinite(n)) return 'none';
  const { checkpointAt, compactAt } = thresholds(reading, policy);
  if (n >= compactAt) return 'compact';
  if (n >= checkpointAt) return 'checkpoint';
  return 'none';
}

export function contextPhrase(reading) {
  // Always the measured number when there is one, so the lead never guesses it.
  return reading && Number.isFinite(reading.tokens) ? ` · ctx ~${Math.round(reading.tokens / 1000)}k` : '';
}

// Live plan usage, when the status line has reported it. Past the caution line
// it says what that means for the next choice, once per crossing.
export function quotaPhrase(q) {
  if (!q) return '';
  const parts = [];
  if (q.fiveHour) parts.push(`5h ${Math.round(q.fiveHour.pct)}%`);
  if (q.week) parts.push(`wk ${Math.round(q.week.pct)}%`);
  return parts.length ? ` · usage ${parts.join(' ')}` : '';
}

export function quotaBand(q) {
  if (!q || !q.fiveHour) return 'none';
  if (q.fiveHour.pct >= HELPER_STOP_FIVE_HOUR) return 'stop';
  if (q.fiveHour.pct >= CAUTION_FIVE_HOUR) return 'caution';
  return 'ok';
}

// Which planned tasks have nothing left to wait for. This is a fact the model
// cannot see without re-reading the whole ledger, which is the router's one
// remaining job. It is reported, never demanded: a lead that should wait is
// still free to wait. It exists because a session was watched sitting idle on
// one agent with a finished plan on the board, and idle turns in a `/goal` loop
// cost quota and buy nothing.
export const READY_SHOWN = 4;

const trim = ids => `${ids.slice(0, READY_SHOWN).join(', ')}${ids.length > READY_SHOWN ? ` +${ids.length - READY_SHOWN} more` : ''}`;

export function readyPhrase(run) {
  const ready = (run && run.ready) || [];
  return ready.length ? ` · ready now: ${trim(ready)}` : '';
}

// Work that came back while nobody was looking. The ledger hook files a return
// and indexes it; setting the row is the lead's, because that is the moment
// anyone actually judges it. This is the other half of that trade: the row
// stays honest, and the router carries the reminder that one is owed. It also
// keeps `ready now` truthful, since readiness is computed from those same rows.
export function ungradedPhrase(run) {
  const ungraded = (run && run.ungraded) || [];
  if (!ungraded.length) return '';
  const n = ungraded.length;
  return ` · ${n} return${n === 1 ? '' : 's'} to grade: ${trim(ungraded)}`;
}

const round1 = n => Math.round(Number(n) * 10) / 10;

// How much of the run's stated budget the subagents have spent. Shown only when
// a ceiling exists, so it is a progress-to-limit reading, never an open-ended
// running total — the thing the plugin refuses because it reads as an allowance.
// With a ceiling it is exactly the "how close to the wall" number the user asked
// to see. The lead conversation's own cost is not in it; no hook sees that.
export function budgetPhrase(run) {
  const c = run && run.budget && run.budget.ceiling;
  if (c == null) return '';
  const spent = Number(run && run.spend) || 0;
  return ` · subagent spend ~$${round1(spent)}/$${c}`;
}

export function progressPhrase(run) {
  const total = Number(run && run.rows) || 0;
  if (!total) return '';
  return ` · ${Number(run.done) || 0}/${total} done`;
}

// The difference between "nothing is ready" and "I cannot see the edges". The
// second is a fixable ledger problem — the task table has no `blocks on` column
// — and saying so is what turns a silent, misleading empty into a one-line fix.
export function edgesPhrase(run) {
  return run && run.edgesMissing
    ? ' · ⚠ task table has no "blocks on" column, so I cannot tell which tasks are ready to run in parallel — add it (see the template)'
    : '';
}

export function runPhrase(ctx) {
  // Show the run's management picture even when this session has not bound it.
  // A session that starts above its repo never auto-binds, so the readiness and
  // budget lines never rendered — the whole reason a run could sit with three
  // unblocked tasks and nobody starting them. Displaying is read-only; a hook
  // that writes still needs the binding, which is a separate thing.
  const focus = ctx.run || (ctx.candidates.length === 1 ? ctx.candidates[0] : null);
  if (focus) {
    const how = ctx.run ? ctx.runHow : 'candidate, not bound — bind before a dispatch writes through it';
    return `run: ${focus.runId} (${how})${budgetPhrase(focus)}${progressPhrase(focus)}${ungradedPhrase(focus)}${readyPhrase(focus)}${edgesPhrase(focus)}`;
  }
  if (ctx.candidates.length > 1) return `run: none bound; ${ctx.candidates.length} candidates in this repo`;
  return 'run: none';
}

export function stateHash(ctx) {
  // The focus run is what the line actually reports, bound or a lone candidate,
  // so its readiness and progress are what should trigger a reprint.
  const focus = ctx.run || (ctx.candidates.length === 1 ? ctx.candidates[0] : null);
  return [
    ctx.tier, ctx.agents, focus ? focus.runId : '', ctx.candidates.length,
    // A task becoming ready is the moment the line is worth reprinting, and the
    // moment a waiting lead has something better to do. A return landing, a row
    // finally being set, or a wave completing is the same kind of moment.
    focus && focus.ready ? focus.ready.join(',') : '',
    focus && focus.ungraded ? focus.ungraded.join(',') : '',
    focus ? `${focus.done || 0}/${focus.rows || 0}` : '',
    focus && focus.edgesMissing ? 'edges?' : '',
    ctx.limits.join(','), ctx.self ? `${ctx.self.model}/${ctx.self.effort}` : '',
    // The band, not the number: a line every percent would be noise.
    quotaBand(ctx.quota), contextBand(ctx.context), ctx.codex || codexState(),
  ].join('|');
}
