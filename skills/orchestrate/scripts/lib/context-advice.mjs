// lib/context-advice.mjs — what to do about a reading, and how to say it.
//
// This is the advice half of the context reader: pure functions over a reading
// (from lib/context-scan.mjs) and the policy, plus the small amount of disk
// reading needed to say whether a checkpoint already exists. It does not
// write anything, and it does not know about the per-session store; that is
// lib/context-store.mjs, which imports from here.

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { loadPolicy } from './policy.mjs';
import { CONTEXT_DIR, JUST_COMPACTED_RESPONSES, idPart, readRange } from './context-scan.mjs';
import { readSettings, parseAutocompact } from './settings.mjs';

// The autocompact window a notice reports, in the order that actually governs
// the host: the environment (a child run can override it per-process, and
// settings.json is not the whole story there), then settings.json (what
// orchestrate itself wrote), then the policy default. Neither `env` nor
// `settingsPath` is read unless a caller supplies it — the real hook passes
// its own process.env and the real settings path; a caller that omits them
// (every test, and any other pure call) never sees this machine's own values.
export function resolveAutocompactWindow(policy, { env = {}, settingsPath = null } = {}) {
  const fromEnv = parseAutocompact(env && env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, { allowOff: true });
  if (fromEnv) return fromEnv;
  if (settingsPath) {
    const settings = readSettings(settingsPath);
    const fromSettings = parseAutocompact(settings && settings.env && settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, { allowOff: true });
    if (fromSettings) return fromSettings;
  }
  return policy.context.autocompactDefault;
}

// `ctx` (env, settingsPath) is only read when the reading itself carries no
// capacity: a known reading always wins, since it is the real transcript's
// own window. Without one, the autocompact window this host will actually
// hit (resolveAutocompactWindow) stands in for it, so a narrower window than
// the policy default (say CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000) still gets
// a checkpoint/compact ask before autocompact fires, not after.
export function thresholds(reading, policy = loadPolicy(), ctx = {}) {
  const c = policy.context;
  let compactAt = c.compactAt;
  if (reading && reading.capacity) {
    compactAt = Math.min(compactAt, Math.floor(reading.capacity * c.windowFraction));
  } else {
    const window = resolveAutocompactWindow(policy, ctx);
    if (window !== 'off' && Number.isFinite(window)) {
      compactAt = Math.min(compactAt, Math.floor(window * c.windowFraction));
    }
  }
  const checkpointAt = Math.min(c.checkpointAt, Math.floor(compactAt * 0.8));
  return { checkpointAt, compactAt };
}

export function contextEpoch(reading) {
  return reading && reading.compaction ? (reading.compaction.uuid || reading.compaction.at || 'c') : 'none';
}

// When the current epoch began, best-effort. A compaction starts a fresh one
// at the moment it happened; before any compaction, the epoch is the whole
// session, so its start is the transcript's own first line. Null means
// neither fact is available (no transcript, or one this process cannot read),
// and callers treat that as "cannot tell", not as "just started".
export function contextEpochStart(reading) {
  const at = reading && reading.compaction && reading.compaction.at;
  if (at) { const t = Date.parse(at); if (Number.isFinite(t)) return t; }
  const path = reading && reading.transcript;
  if (!path) return null;
  try {
    const size = statSync(path).size;
    if (!size) return null;
    const text = readRange(path, 0, Math.min(size, 65536));
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec && rec.timestamp) { const t = Date.parse(rec.timestamp); if (Number.isFinite(t)) return t; }
    }
  } catch { /* fall through */ }
  return null;
}

export function checkpointPath(session, reading, dir = CONTEXT_DIR) {
  const epoch = contextEpoch(reading);
  // "none" means no compaction has happened yet this session, not that the
  // file itself is nameless — say what the file is instead of echoing that
  // internal sentinel into a name a user might read.
  const id = epoch === 'none' ? idPart(session || 'nosession') : idPart(epoch);
  return join(dir, idPart(session || 'nosession'), `checkpoint-${id}.md`);
}

export const PLANS_DIR = join(homedir(), '.claude', 'plans');

// A real checkpoint for the current epoch, honestly: not only the plugin's own
// file, but anything a resuming session would actually be able to read back.
//   - the plugin checkpoint at `checkpointPath` (today's behaviour)
//   - `runMd` (the session's bound run, if any) when its Pickup section carries
//     real text and the file was touched after the epoch began. Checked by
//     content, not by mtime alone: `run-init.mjs --reopen` touches RUN.md's
//     mtime with no text change (a deliberate, rare CLI action, not something
//     a hook does mid-session), so a written-but-unchanged Pickup can still
//     read as fresh in that one case. Accepted as the smallest honest check
//     available without a second store recording Pickup's text across epochs.
//   - in plan mode only, the newest `*.md` under `plansDir` (the host's own
//     plan file), because the plan is the checkpoint while a plan is what the
//     user asked for and helpers may be forbidden to write anything else.
// The newest of the same candidates `hasCheckpoint` accepts, as a fact a
// notice can print: `{ path, mtimeMs }`, or null when none qualifies. Does not
// change what counts as a checkpoint — only reports which one is newest.
export function newestCheckpoint(session, reading, { dir = CONTEXT_DIR, runMd = null, permissionMode = null, plansDir = PLANS_DIR } = {}) {
  let best = null;
  const consider = (path, mtimeMs) => { if (path && Number.isFinite(mtimeMs) && (!best || mtimeMs > best.mtimeMs)) best = { path, mtimeMs }; };
  const p = checkpointPath(session, reading, dir);
  try { if (existsSync(p)) consider(p, statSync(p).mtimeMs); } catch { /* fall through */ }
  const epochStart = contextEpochStart(reading);
  if (epochStart == null) return best;
  if (runMd) {
    try {
      const st = statSync(runMd);
      if (st.mtimeMs > epochStart) {
        const text = readFileSync(runMd, 'utf8');
        const m = /## Pickup\s*\n([\s\S]*?)(?:\n## |\s*$)/.exec(text);
        const prompt = /Pickup prompt:\s*(.*)/.exec(m ? m[1] : '');
        const v = prompt ? prompt[1].trim() : '';
        if (v && !/^<.*>$/.test(v)) consider(runMd, st.mtimeMs);
      }
    } catch { /* no RUN.md, or it moved: not a checkpoint */ }
  }
  if (permissionMode === 'plan') {
    try {
      for (const f of readdirSync(plansDir)) {
        if (!f.endsWith('.md')) continue;
        const fp = join(plansDir, f);
        const st = statSync(fp);
        if (st.mtimeMs > epochStart) consider(fp, st.mtimeMs);
      }
    } catch { /* no plans directory on this machine */ }
  }
  return best;
}

// A checkpoint written beside the transcript's own folder (where a lead tends
// to look) instead of in the folder this plugin reads. It does not count as a
// checkpoint; it is only reported so the notice can say where to move it.
export function misplacedCheckpoint(session, reading, { dir = CONTEXT_DIR } = {}) {
  const t = reading && reading.transcript;
  if (!t) return null;
  const want = checkpointPath(session, reading, dir);
  const p = join(dirname(t), 'orchestrate', 'context', relative(dir, want));
  try { if (p !== want && existsSync(p)) return { path: p, moveTo: want }; } catch { /* unreadable: not found */ }
  return null;
}

export function hasCheckpoint(session, reading, opts = {}) {
  return newestCheckpoint(session, reading, opts) != null;
}

// What to do about the current size. The key changes only when the advice
// does, and it carries the compaction epoch, so a compaction resets it.
export function adviseContext(reading, policy = loadPolicy(), ctx = {}) {
  const epoch = contextEpoch(reading);
  const key = action => `${epoch}|${action}`;
  if (!reading || reading.state === 'unknown' || reading.tokens == null) {
    return { action: 'unknown', key: key('unknown'), why: reading && reading.stale ? 'the last measurement is stale' : 'no model response has reported usage yet' };
  }
  const { checkpointAt, compactAt } = thresholds(reading, policy, ctx);
  const k = n => `${Math.round(n / 1000)}k`;
  if (reading.state === 'provisional') {
    if (reading.tokens >= compactAt) return { action: 'investigate', key: key('investigate'), why: `the compaction summary alone is reported at ${k(reading.tokens)}` };
    return { action: 'none', key: key('provisional'), why: 'compacted; waiting for the next response to measure' };
  }
  const just = reading.compaction && reading.responsesSinceCompaction != null && reading.responsesSinceCompaction <= JUST_COMPACTED_RESPONSES;
  if (just && reading.tokens >= compactAt) return { action: 'investigate', key: key('investigate'), why: `${k(reading.tokens)} right after compaction` };
  // Compacting is the default answer to a full conversation, because it keeps
  // the user where they are. Each summary drops detail, though, so once this
  // session has been compacted `freshAfterCompactions` times the next full
  // conversation is better served by a fresh one resuming from the checkpoint.
  const fresh = (Number(reading.compactions) || 0) >= policy.context.freshAfterCompactions;
  if (reading.tokens >= compactAt) return { action: 'compact', fresh, key: key('compact'), why: `${k(reading.tokens)} is at or above ${k(compactAt)}` };
  if (reading.tokens >= checkpointAt) return { action: 'checkpoint', key: key('checkpoint'), why: `${k(reading.tokens)} is at or above ${k(checkpointAt)}` };
  // A reading below both lines can still be the last one the lead ever sees
  // in this band: a turn that adds as much again as it just added would land
  // past the compact line in one step, with the checkpoint ask never having
  // fired (the band it would have fired in is stepped over, not landed in).
  // `lastDelta` is the growth from the previous reading to this one, 0 when
  // there is no previous reading in this epoch (lib/context-store.mjs sets it).
  const lastDelta = Number(reading.lastDelta) || 0;
  if (lastDelta > 0 && reading.tokens + lastDelta >= compactAt) {
    return { action: 'checkpoint', key: key('checkpoint'), why: `${k(reading.tokens)} plus the last growth of ${k(lastDelta)} would reach ${k(compactAt)}` };
  }
  return { action: 'none', key: key('none'), why: `${k(reading.tokens)} is below ${k(checkpointAt)}` };
}

const CHECKPOINT_WHAT ='the goal, decisions made, files changed, verification results, outstanding work, and the next action';

// Which switch to recommend when the conversation is full: compact by default,
// a fresh conversation only when compacting has stopped paying.
export function switchAdvice(reading, advice) {
  const n = Number(reading && reading.compactions) || 0;
  if (advice && advice.fresh) return `recommend a fresh conversation that resumes from the checkpoint: this one has already been compacted ${n} time${n === 1 ? '' : 's'}, and each summary drops detail`;
  return 'recommend compacting if this same task continues; a fresh conversation only if the task changes or a finished phase will resume from saved files';
}

const k1 = n => `~${Math.round(n / 1000)}k`;

// A written-N-min-ago-or-just-now age, the same style as a helper's own
// progress-file fact (context-check.mjs's `progressFact`).
function ageStr(mtimeMs, now) {
  const m = Math.round((now - mtimeMs) / 60000);
  if (!Number.isFinite(m)) return 'time unknown';
  return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// The window this line reports against: the size the host itself reported for
// this conversation, and nothing else. The autocompact setting is not a
// capacity: in a real run with it at 100000 the host still reported ~180k and
// compacted at 153,010, so neither the setting nor a policy default is printed
// as if it were the window. Null when the host has not said.
function reportedWindow(reading) {
  return reading && reading.capacity ? reading.capacity : null;
}

// The next thing this plugin will do at a size: its own compact line
// (`thresholds()`), when not yet passed. The host's own automatic compaction
// point is not promised: it is not known (see `reportedWindow`), so no figure
// is printed for it. Null once the compact line is behind the current size.
function nextEvent(reading, policy, ctx = {}) {
  const { compactAt } = thresholds(reading, policy, ctx);
  return reading.tokens < compactAt ? { label: 'compact', at: compactAt } : null;
}

// One line of facts about the conversation's size: this is the single shape
// behind the checkpoint notice, the compact notice, and the periodic tick.
// No instruction words here: the one ask, for a missing checkpoint, is added
// by `contextNotice` alone, so it is said once per epoch and never on a tick.
function factLine(reading, policy, ctx = {}, cp = undefined) {
  const { session = null, editCounter = null, dir = CONTEXT_DIR, runMd = null, permissionMode = null, now = Date.now() } = ctx;
  const parts = [];
  const window = reportedWindow(reading);
  parts.push(`${k1(reading.tokens)}${window ? ` of ${k1(window)}` : ''}`);
  const n = Number(reading.compactions) || 0;
  if (n) parts.push(`compacted ${n}×`);
  const next = nextEvent(reading, policy, ctx);
  if (next) parts.push(`next: ${next.label} ${k1(next.at)}`);
  if (cp === undefined) cp = newestCheckpoint(session, reading, { dir, runMd, permissionMode });
  const lost = cp ? null : misplacedCheckpoint(session, reading, { dir });
  parts.push(cp ? `newest checkpoint: ${cp.path}, ${ageStr(cp.mtimeMs, now)}` : lost ? `newest checkpoint: none in the folder this plugin reads; one is at ${lost.path}, outside it: move it to ${lost.moveTo}` : 'newest checkpoint: none');
  if (Number.isFinite(editCounter)) parts.push(`${editCounter} tool call${editCounter === 1 ? '' : 's'} since your last edit`);
  return `[orchestrate · context] ${parts.join(' · ')}`;
}

// Whether the "just summarised" ask is due: a compaction this store has not
// asked about yet (`ctx.askedAfterCompactions`, kept by lib/context-store.mjs,
// compared against `reading.compactions`), with nothing else already saying
// something for this reading (`action === 'none'`) and no checkpoint yet for
// the epoch. Keyed on the compaction count rather than
// `responsesSinceCompaction === 0` so it fires on the first reading of any
// state (provisional or measured) after the boundary, not only a sample that
// happens to land before the first response — a sample that lands after does
// not miss it, and a second compaction the lead never sampled right after
// still gets its own ask. Exported so lib/context-store.mjs can record the
// count it asked about without re-deriving this from the notice text.
export function postCompactionAskDue(reading, advice, ctx = {}) {
  if (!reading || !advice || advice.action !== 'none' || !reading.compaction) return false;
  const asked = Number(ctx.askedAfterCompactions) || 0;
  // A reading straight from lib/context-scan.mjs's readContext (no store
  // history behind it, e.g. context.mjs's on-demand report, or a test that
  // builds a reading directly) carries no `compactions` count at all; a
  // compaction object present is itself the fact that one has happened, so
  // that counts as compaction 1, the same as the old behaviour it replaces.
  const compactions = Number.isFinite(reading.compactions) ? reading.compactions : 1;
  if (!(compactions > asked)) return false;
  const { session = null, dir = CONTEXT_DIR, runMd = null, permissionMode = null } = ctx;
  return !newestCheckpoint(session, reading, { dir, runMd, permissionMode });
}

// The short notice for an advice change; empty when there is nothing to say.
// Never recommend a switch from memory or an old number: only this notice,
// measured from the last response, says the conversation is full. `ctx` carries
// what `factLine` needs (policy, session, editCounter, runMd, permissionMode);
// see `sampleContext`.
export function contextNotice(reading, advice, ctx = {}) {
  if (!reading || !advice) return '';
  const policy = ctx.policy || loadPolicy();
  // Right after a compaction, before anything else: a PreCompact block reaches
  // nobody under autocompact, so this is the one place the lead hears that the
  // conversation was just summarised.
  if (postCompactionAskDue(reading, advice, ctx)) {
    const { session = null, dir = CONTEXT_DIR } = ctx;
    const line = factLine(reading, policy, ctx, null);
    return `${line} · the conversation was just summarised; before anything else, write the checkpoint now (goal, decisions, files changed, verification, next action) to ${checkpointPath(session, reading, dir)}`;
  }
  switch (advice.action) {
    case 'checkpoint':
    case 'compact': {
      // With no checkpoint for this epoch, this is the one place the lead is
      // asked for one: a PreCompact block reaches nobody under autocompact.
      const { session = null, dir = CONTEXT_DIR, runMd = null, permissionMode = null } = ctx;
      const cp = newestCheckpoint(session, reading, { dir, runMd, permissionMode });
      const line = factLine(reading, policy, ctx, cp);
      if (cp) return line;
      if (advice.action === 'compact') return `${line} · compaction will summarise without a checkpoint`;
      return `${line} · write the checkpoint now (goal, decisions, files changed, verification, next action) to ${checkpointPath(session, reading, dir)}`;
    }
    case 'investigate': {
      const c = reading.compaction || {};
      const was = c.preTokens != null && c.postTokens != null ? ` (compaction took it from ${k1(c.preTokens)} to ${k1(c.postTokens)})` : '';
      return `[orchestrate · context] still ${k1(reading.tokens)} tokens right after compaction${was}. Compacting again will not help: something restored on every step is large. Check CLAUDE.md and memory files, plugin, skill and MCP tool listings, and any large tool output being carried, before recommending anything else.`;
    }
    default:
      return '';
  }
}

// The measured size as a short line, keyed by compaction epoch and a step of
// `tickEvery` tokens, so it is said once per step and again after a compaction.
// Same shape as `contextNotice`'s checkpoint/compact text — see `factLine`.
export function contextTick(reading, policy = loadPolicy(), ctx = {}) {
  const every = policy.context.tickEvery;
  if (!every || !reading || reading.tokens == null || !Number.isFinite(reading.tokens)) return { key: null, text: '' };
  if (reading.state !== 'measured' && reading.state !== 'provisional') return { key: null, text: '' };
  return {
    key: `${contextEpoch(reading)}|${Math.floor(reading.tokens / every)}`,
    text: factLine(reading, policy, ctx),
  };
}

// ---- readable report --------------------------------------------------------

export function formatReading(reading, advice, { now = Date.now() } = {}) {
  const L = [];
  const k = n => (n == null ? 'unknown' : `${Math.round(n / 1000)}k`);
  const age = t => {
    if (!t) return 'time unknown';
    const m = Math.round((now - Date.parse(t)) / 60000);
    return !Number.isFinite(m) ? 'time unknown' : m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  L.push(`context: ${k(reading.tokens)}${reading.capacity ? ` of ${k(reading.capacity)} (${reading.pct}%)` : ''} — ${reading.state}`);
  if (reading.state === 'measured') L.push(`  measured from response ${reading.responseId || '(no id)'}${reading.model ? ` on ${reading.model}` : ''}, ${age(reading.measuredAt)}`);
  if (reading.state === 'provisional') L.push('  from the compaction record only; the next response will measure it');
  if (reading.stale) L.push(`  the last measurement (${k(reading.lastTokens)}, ${age(reading.measuredAt)}) is stale, so it is not used`);
  if (reading.compaction) {
    const c = reading.compaction;
    L.push(`  last compaction: ${age(c.at)}${c.trigger ? `, ${c.trigger}` : ''}${c.preTokens != null ? `, ${k(c.preTokens)} → ${k(c.postTokens)}` : ''}${reading.responsesSinceCompaction != null ? `, ${reading.responsesSinceCompaction} response(s) since` : ''}`);
  } else if (reading.responsesSinceCompaction == null && reading.state !== 'unknown') {
    L.push('  no compaction in the part of the transcript read');
  }
  if (!reading.capacity) L.push('  window size: not known here (install the status line, or set policy context.window)');
  if (reading.host && reading.host.version) L.push(`  host: ${reading.host.entrypoint || 'unknown entrypoint'} ${reading.host.version} (from this transcript)`);
  L.push(`recommended: ${advice.action} — ${advice.why}`);
  return L.join('\n');
}
