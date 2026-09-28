#!/usr/bin/env node
// router.mjs — the session's context provider. A UserPromptSubmit + SessionStart
// hook that tells the model, once, the local state it cannot see for itself:
// which plan this account is on, which role agents are installed, which model
// family hit a limit today, and which coordinated run this session is bound to.
//
// It used to do more, and the more was the problem. A table of regular
// expressions read each message, put it on a rung of a ten-rung ladder, and
// injected an instruction naming an agent, a research depth, a reviewer or a
// permission request. A pattern in the wording is not evidence about the work:
// "six files" is not a reason to delegate, "should we" is not a reason to
// research, and the word "deploy" is not a reason to ask permission for an edit.
// Choosing the shape of the work is the model's job, made from the work itself.
// This file now reports facts and stays quiet.
//
// Never blocks, never rewrites input, never exits non-zero. No network. The
// one child process: `git rev-parse HEAD`, read once on a session's first
// prompt and kept as `startHead`, so the Stop hook's commit check (lib/
// commit-claim.mjs) can later count commits made since this session began.
//
//   echo '<hook json>' | node router.mjs          hook mode (stdin)
//   node router.mjs --state                       what it would inject, no writes
//   node router.mjs --cost <transcript.jsonl>     what the router cost that session
//   node router.mjs --prune                       delete session state older than 7 days

import { readFileSync, existsSync, unlinkSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectTier, routerSettings, agentsInstalled, findRepoRoot, resolveRun,
  loadSession, saveSession, sessionPath, pruneSessions, readTail, selfModel,
  DIR, readJson, writeJsonAtomic, FAMILY_ORDER, AGENT_NAMES,
  SESSIONS_DIR, PROFILE_PATH,
} from './lib/tier.mjs';
import { sampleContext, storedContext } from './lib/context-store.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote } from './lib/workers.mjs';
import { LISTING_REPORT_PATH, LISTING_REPORT_MIN_TOKENS, pluginFitReport } from './lib/listing.mjs';
import { readQuota, resetClock, CAUTION_FIVE_HOUR, HELPER_STOP_FIVE_HOUR, limitsFromTail, scanLimits } from './lib/quota.mjs';
import { autocompactOffer, applyAutocompact, removeAutocompact, parseAutocompact } from './lib/settings.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { UNCAPPED_GATE_ROLE } from './lib/workflow.mjs';
import { findPreviousSession } from './lib/handoff.mjs';
import { CARD, CARD_CAP, cardBody, shortCard, compactNote, autocompactTip, autocompactOffNote } from './lib/card.mjs';
import { BRIEF_CAP, briefState, briefNote } from './lib/brief.mjs';
import {
  stillRunningNative, unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact,
} from './lib/recover.mjs';
import { PERSIST_INTENT, syntheticPrompt, persistIntent, GOAL_CAP, persistLine } from './lib/persist-words.mjs';
import {
  stateLine, statusReply, actionableLine, contextBand, contextPhrase, quotaPhrase, quotaBand,
  READY_SHOWN, readyPhrase, ungradedPhrase, budgetPhrase, progressPhrase, edgesPhrase, runPhrase,
  stateHash, codexState,
} from './lib/state-line.mjs';
import {
  RESUME_CAP, sectionExcerpt, resumeExcerpt, checkpointExcerpt,
  handoffLine, continueIntent, CONTINUE_WORD,
} from './lib/resume.mjs';

export { CARD, CARD_CAP, cardBody, shortCard, compactNote };
export {
  stateLine, statusReply, actionableLine, contextBand, contextPhrase, quotaPhrase, quotaBand,
  READY_SHOWN, readyPhrase, ungradedPhrase, budgetPhrase, progressPhrase, edgesPhrase, runPhrase,
  stateHash, codexState,
};
export { RESUME_CAP, sectionExcerpt, resumeExcerpt, checkpointExcerpt, handoffLine, continueIntent, CONTINUE_WORD };
export { BRIEF_CAP, briefState, briefNote };
export { cappedNote };
export { unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact };
export { PERSIST_INTENT, syntheticPrompt, persistIntent, GOAL_CAP, persistLine };
export { limitsFromTail, LISTING_REPORT_PATH, LISTING_REPORT_MIN_TOKENS, PROFILE_PATH, pluginFitReport };

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- local context ----------------------------------------------------------
// The lead's own cost per step comes from the shared reader (lib/context-store.mjs),
// said only when its advice changes. A compaction starts a new epoch there, so
// advice given before it is never repeated against the compacted conversation.
export function contextLine(input, { force = false } = {}) {
  try {
    if (!input || !input.transcript_path) return '';
    return sampleContext({ transcriptPath: input.transcript_path, session: input.session_id || null, force }).notice || '';
  } catch { return ''; }
}

// Once a week per plan, model and effort: the lead running above what
// quota-first work needs. The user chose it, so this is said, never changed.
export const LEAD_NOTE_PATH = join(DIR, 'lead-note.json');

export function leadNote(self, tier, now = Date.now(), path = LEAD_NOTE_PATH) {
  if (!self || !self.effort || !['xhigh', 'max'].includes(self.effort)) return '';
  const key = `${tier}|${self.model}|${self.effort}`;
  const seen = readJson(path) || {};
  if (seen[key] && now - Number(seen[key]) < 7 * 86400000) return '';
  try { writeJsonAtomic(path, { ...seen, [key]: now }); } catch {}
  return `[orchestrate · lead setting] this session runs ${self.model} at ${self.effort} effort on plan ${tier}. Effort multiplies the output and thinking of every step; on Opus 5, Anthropic measured medium at about 2 points below high for half the cost. For quota-first work, high or medium is the better default. Mention it to the user once: it takes effect in a new session, because switching mid-session re-reads everything uncached.`;
}

function gatherContext(input, state) {
  // Read every prompt, not once per session: the plan can be set mid-session
  // (profile.mjs --set tier), and a session that started before a fix kept
  // reporting "unknown" all day. Two small files and a directory listing.
  { const t = detectTier(); state.tier = t.tier; state.tierSource = t.source; }
  const repoRoot = findRepoRoot(input.cwd);
  const r = resolveRun(input.session_id, input.cwd);
  const limits = scanLimits(input.transcript_path, state);
  state.limits = limits;
  const self = selfModel(input.transcript_path);
  if (self) state.self = self;

  // A single unambiguous open run inside this repo binds itself, so a hook that
  // writes has an association to write through. Anything less certain stays a
  // candidate the lead has to claim on purpose. The binding is written onto the
  // state object this handler will save; writing it through a second load would
  // be undone by that save.
  if (r.run && repoRoot) {
    state.run = { root: r.run.root, runId: r.run.runId, runMd: r.run.runMd, boundAt: (state.run && state.run.boundAt) || new Date().toISOString() };
  }

  const agentsInfo = agentsInstalled();
  return {
    tier: state.tier,
    agents: agentsInfo.installed,
    agentsExpected: agentsInfo.expected,
    agentsMissing: agentsInfo.missing,
    repoRoot,
    cwd: input.cwd || null,
    run: r.run,
    runHow: r.how,
    candidates: r.candidates || [],
    limits,
    self: self || state.self || null,
    persist: Boolean(state.persist && state.persist.armed),
    quota: readQuota(),
    context: storedContext(input.session_id || null),
    codex: codexState(),
  };
}

function transcriptSize(p) {
  try { return p ? statSync(p).size : 0; } catch { return 0; }
}

// A build word (or "and then", which chains a second step onto the first)
// means the prompt is shaping work, not just naming a fix — the full card
// earns its cost there even on a short sentence.
const BUILD_WORDS = /\b(build|make|create|add|implement|design|plan|feature|app|system|project|refactor|migrate|ship|deploy|release|integrate|wire|set ?up)\b|\band then\b/i;

// "Small": one sentence (no sentence-ending punctuation before the very end),
// under about 15 words, and none of BUILD_WORDS. Called only once a prompt is
// already known to be substantive.
function isSmallPrompt(trimmed) {
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 15) return false;
  const withoutEnding = trimmed.replace(/[.!?]+\s*$/, '');
  if (/[.!?]/.test(withoutEnding)) return false;
  return !BUILD_WORDS.test(trimmed);
}

// The repo HEAD at the moment this session starts, or null when the cwd is
// not a git repo (or git is missing) — either is a silent skip, never a
// thrown error. A short timeout keeps a hung git from holding up the prompt.
function currentHead(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: cwd || undefined, timeout: 3000, encoding: 'utf8' });
    if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  return null;
}

function newState(input) {
  return {
    v: 1, session_id: input.session_id || 'unknown', cwd: input.cwd || '',
    started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false,
    lastPromptId: null, lastStateHash: null, limits: [],
    startHead: currentHead(input.cwd),
  };
}

// ---- hook handlers ----------------------------------------------------------
function emit(event, text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

function promptText(input) {
  for (const k of ['prompt', 'user_prompt', 'prompt_text']) if (typeof input[k] === 'string') return input[k];
  for (const [k, v] of Object.entries(input)) if (/prompt/i.test(k) && !/id$/i.test(k) && typeof v === 'string') return v;
  return null;
}

// Everything the model cannot see, once; then nothing until one of those facts
// changes. A message whose wording differs from the last one is not a change of
// state, and the old router treated it as one.
function handlePrompt(input) {
  // A hook fires inside a subagent's own call too, with `agent_id` set on the
  // stdin payload (hooks doc, "common input fields"). Nothing here is about
  // that subagent's own work — the plan tier, the run ledger, the card — so
  // printing it there was pure noise a helper paid to read about itself.
  if (input && input.agent_id) return;
  if (!routerSettings().enabled) return;
  const text = promptText(input);
  if (text == null) return;
  const state = loadSession(input.session_id) || newState(input);
  // A session recorded before this field existed has no startHead yet; fill
  // it in from whatever the repo's HEAD is now, the same as a brand-new one.
  if (state.startHead === undefined) state.startHead = currentHead(input.cwd);

  const promptKey = input.prompt_id
    ? `${input.prompt_id}:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`
    : null;
  if (promptKey && state.lastPromptId === promptKey) return;
  if (promptKey) state.lastPromptId = promptKey;

  const trimmed = text.trim();

  // The host also submits its own notices through this hook: a background
  // task finishing arrives as a prompt that opens "[SYSTEM NOTIFICATION - NOT
  // USER INPUT]" or "<task-notification>". Nothing in it is the user's words,
  // so it must not arm a loop, pin a goal, grant a model or spend the card.
  // Seen live: a finished helper's notice became the persist goal.
  if (syntheticPrompt(trimmed)) { saveSession(state); return; }

  // A fresh session reading this record later (findPreviousSession) needs to
  // know this one is still recent, on every real prompt, not only the first.
  state.lastSeen = new Date().toISOString();

  // The one party that sees the user's own words, not a role agent's packet. A
  // family named here unlocks an executor above Sonnet for guard-agent.mjs —
  // for the one task id that first spends it, recorded there, not here. One
  // regex per prompt, nothing added to context.
  //
  // Only a family ranked above Sonnet is a grant worth recording (Sonnet is
  // already the default, Haiku never needs one), and among those the earliest
  // one named in the prompt wins — not FAMILY_ORDER's ladder position, which
  // made "use opus, not fable" record fable because the ladder checks fable
  // first. A prompt naming none of them leaves an existing grant alone: a
  // later message about Sonnet or Haiku must not overwrite a live grant.
  const grantFamilies = FAMILY_ORDER.filter(f => FAMILY_ORDER.indexOf(f) < FAMILY_ORDER.indexOf('sonnet'));
  let namedFamily = null, namedAt = Infinity;
  for (const f of grantFamilies) {
    const m = new RegExp(`\\b${f}\\b`, 'i').exec(trimmed);
    if (m && m.index < namedAt) { namedAt = m.index; namedFamily = f; }
  }
  if (namedFamily) state.userModel = { family: namedFamily, at: new Date().toISOString() };

  if (/^router (off|on)$/i.test(trimmed)) { state.muted = /off$/i.test(trimmed); saveSession(state); return; }
  // The full state line, on demand: not a substantive prompt, so it sends no
  // card and arms nothing. The card carries only the actionable one-liner now.
  if (/^router status$/i.test(trimmed)) {
    const ctx = gatherContext(input, state);
    saveSession(state);
    emit('UserPromptSubmit', statusReply(ctx));
    return;
  }
  if (/^persist (off|on)$/i.test(trimmed)) {
    const off = /off$/i.test(trimmed);
    state.persistMuted = off;
    if (off && state.persist) state.persist = { ...state.persist, armed: false, endedAt: new Date().toISOString(), endReason: 'the user said persist off' };
    saveSession(state);
    return;
  }

  // The typed answer to the one-time tip (or a change of mind later): never
  // sends the card, never arms auto-continue. Matched on the whole prompt so
  // it never fires mid-sentence.
  const autoCmd = /^autocompact (on|off|\d+k?)$/i.exec(trimmed);
  if (autoCmd) {
    const settingsPath = join(dirname(DIR), 'settings.json');
    const word = autoCmd[1].toLowerCase();
    if (word === 'off') {
      emit('UserPromptSubmit', autocompactOffNote(removeAutocompact({ settingsPath, markerDir: DIR })));
    } else {
      // 'on' with the tip switched off in the policy still means 200k: the
      // user asked for it by name, so the opt-out of the tip does not apply.
      const policyValue = loadPolicy().context.autocompactDefault;
      const value = word === 'on' ? (parseAutocompact(policyValue) || 200000) : parseAutocompact(word);
      const applied = applyAutocompact({ settingsPath, markerDir: DIR, tokens: value });
      emit('UserPromptSubmit', compactNote(applied));
    }
    saveSession(state);
    return;
  }

  // Armed before the mute check: "router off" silences the card, not a loop
  // the user asked for by name.
  let armedNow = false;
  if (!state.persistMuted && persistIntent(trimmed)) {
    // A bare "keep going" names no goal; it means the one already pinned.
    const prior = state.persist && state.persist.goal;
    const goal = prior && trimmed.split(/\s+/).length < 4 ? prior : trimmed.slice(0, 4000);
    state.persist = { armed: true, goal, armedAt: new Date().toISOString(), sizeAtArm: transcriptSize(input.transcript_path) };
    armedNow = true;
  }
  if (state.muted) { saveSession(state); return; }

  // A slash command, a paste or a two-word reply is not the start of a session's
  // work, and the card is worth its tokens only on something substantive.
  const substantive = !/^\s*\//.test(trimmed) && !/```/.test(trimmed) && trimmed.split(/\s+/).length >= 4;

  // What this session is for, recorded once so a later session in the same
  // folder can answer "continue what?" for itself.
  if (substantive && !state.goal) state.goal = trimmed.replace(/\s+/g, ' ').trim().slice(0, 300);

  const ctx = gatherContext(input, state);
  // A substantive prompt that is still just a single short sentence with no
  // build word in it ("fix the typo in the README") is not worth five
  // paragraphs of behaviour rules on its first turn: the short card covers it,
  // and the full card still arrives on the first request big enough to need it.
  // Not when an open run is already bound: picking up run work is never a
  // small, one-off ask, whatever the sentence looks like.
  const small = substantive && !ctx.run && isSmallPrompt(trimmed);
  const out = [];
  // Plugin settings cannot carry env vars, and this plugin never writes to
  // them without being asked. Offered once, on the first substantive prompt
  // only — a non-substantive prompt (a slash command, "ok") must not spend
  // the one-time marker before the user ever sees the tip.
  const offer = substantive ? autocompactOffer({
    settingsPath: join(dirname(DIR), 'settings.json'), markerDir: DIR, policy: loadPolicy(),
  }) : { offer: false };
  // The mode the host reports, on every prompt: a switch into or out of Plan
  // mode is said once, whatever the prompt looks like.
  const mode = modeNote(state, input);
  if (mode) out.push(mode);

  // The additions that ride along with the full card only: a partial-install
  // notice (guard-agent.mjs refuses general-purpose/claude once orch-implementer
  // itself is installed, whatever the other seven roles are) and a run's resume
  // excerpt. Never on a helper's own first prompt (`agent_id` present): only
  // the lead can fix an install.
  const sendFullCardExtras = () => {
    if (!input.agent_id && ctx.agentsExpected && ctx.agents < ctx.agentsExpected) {
      const missing = Array.isArray(ctx.agentsMissing) ? ctx.agentsMissing : [];
      const guardNote = missing.includes(UNCAPPED_GATE_ROLE)
        ? 'so the guard against uncapped helpers is off'
        : 'the guard against uncapped helpers is on, so the missing roles cannot be sent until the install is finished';
      out.push(`Only ${ctx.agents} of the plugin's ${ctx.agentsExpected} helper roles are installed, ${guardNote}; run \`claude plugin install orchestrate@orchestrate\` (or \`node scripts/install.mjs --with-router --with-hook\`) to complete it.`);
    }
    if (ctx.run) {
      const ex = resumeExcerpt(ctx.run.runMd);
      if (ex) out.push(`[orchestrate · run ${ctx.run.runMd}]\n${ex}`);
    }
  };

  const freshSession = !state.cardSent;
  if (!state.cardSent && substantive) {
    const opening = actionableLine(ctx);
    out.push(opening ? `[orchestrate] ${opening}` : '[orchestrate]');
    if (small) {
      // A short sentence with no build word in it: the short card covers it,
      // and the full card still arrives on the first later request big enough
      // to need it (state.cardSent === 'short' below).
      out.push(shortCard());
      state.cardSent = 'short';
    } else {
      out.push(cardBody());
      sendFullCardExtras();
      state.cardSent = true;
    }
    state.lastStateHash = stateHash(ctx);
    state.lastActionable = opening;
  } else if (state.cardSent === 'short' && substantive && !small) {
    // The short card already ran once; this is the first request big enough
    // to earn the full one, sent exactly like a first prompt would be.
    const opening = actionableLine(ctx);
    out.push(opening ? `[orchestrate] ${opening}` : '[orchestrate]');
    out.push(cardBody());
    sendFullCardExtras();
    state.cardSent = true;
    state.lastStateHash = stateHash(ctx);
    state.lastActionable = opening;
  } else if (substantive) {
    const hash = stateHash(ctx);
    const changed = actionableLine(ctx);
    if (changed && changed !== state.lastActionable) out.push(`[orchestrate · changed] ${changed}`);
    state.lastStateHash = hash;
    state.lastActionable = changed;
  }

  // A brand-new session's first prompt naming no goal of its own — "continue"
  // is one word and never trips the substantive gate above, so this checks
  // for it on its own. Said once per session, whether or not the card fired.
  if (freshSession && !state.handoffShown && continueIntent(trimmed)) {
    const prev = findPreviousSession({ sessionsDir: SESSIONS_DIR, cwd: input.cwd, exceptId: input.session_id, now: Date.now() });
    if (prev) out.push(handoffLine(prev, ctx));
    state.handoffShown = true;
  }

  // Said once, after the state line rather than before it: a question, not a
  // notice — nothing is written until the user types the command back.
  if (offer.offer) out.push(autocompactTip(offer.value));

  if (substantive) {
    const brief = briefNote(ctx, state);
    if (brief) out.push(brief);
  }

  // What a usage band means for the next choice, said once per band.
  const band = quotaBand(ctx.quota);
  if (band !== (state.quotaBand || 'none') && (band === 'caution' || band === 'stop')) {
    const h = ctx.quota.fiveHour;
    out.push(band === 'stop'
      ? `[orchestrate · usage] the 5-hour window is at ${Math.round(h.pct)}% (resets ${resetClock(h.resetsAt)}). No new helpers will start. Finish what is in flight here, keep steps few, and tell the user where things stand if the work will not fit.`
      : `[orchestrate · usage] the 5-hour window is at ${Math.round(h.pct)}%. Work serially, on the cheapest model that can do each step, and do small things yourself rather than starting helpers.`);
  }
  state.quotaBand = band;

  // Which installed plugins fit, when the set is first seen or grows; the lead's
  // own per-step size; and a lead setting above quota-first.
  if (substantive) {
    const line = pluginFitReport(input.transcript_path);
    if (line) out.push(`[orchestrate · plugins] ${line}`);
    const note = contextLine(input);
    if (note) out.push(note);
    const lead = leadNote(ctx.self, ctx.tier);
    if (lead) out.push(lead);
    const hidden = staleNote(ctx.repoRoot);
    if (hidden) out.push(hidden);
    const capped = cappedNote(state);
    if (capped) out.push(capped);
    // A usage limit just landed: the moment helpers may have died mid-task.
    const limitKey = ctx.limits.join(',');
    if (limitKey && state.recoverShownFor !== limitKey) {
      const lost = unreturnedNote(state, { native: stillRunningNative(input, state) });
      if (lost) out.push(lost);
      state.recoverShownFor = limitKey;
    }
  }

  if (armedNow) {
    out.push(`[orchestrate · persist] ${persistLine(state.persist)}`);
    // The existing budget and readiness machinery only engages for a run. Point
    // at it once, for work big enough to deserve it, rather than rebuild it.
    if (!ctx.run) out.push('If this goal is several separable tracks, or will outlive this session, open a run with a budget first (run-init.mjs --budget) so readiness and spend are tracked; for direct work, just start.');
  }

  if (substantive) state.prompts++;
  saveSession(state);
  maybePrune();
  emit('UserPromptSubmit', out.join('\n'));
}

// Resume and compaction are the two moments the goal is actually at risk, so
// this is where the excerpt earns its tokens.
function handleSessionStart(input) {
  // Same as handlePrompt: a SessionStart:compact fired inside a subagent (the
  // helper's own compaction) is not this session's card to reprint.
  if (input && input.agent_id) return;
  if (!routerSettings().enabled) return;
  const source = input.source || 'startup';
  if (source === 'clear') { try { unlinkSync(sessionPath(input.session_id)); } catch {} return; }
  if (source === 'startup') { pruneSessions(7); return; }
  if (source !== 'resume' && source !== 'compact') return;

  const state = loadSession(input.session_id) || newState(input);
  const ctx = gatherContext(input, state);
  const out = [];
  const word = source === 'resume' ? 'resumed' : 'compacted';

  // The summary keeps the conversation's gist, not the card that was injected
  // into it, so without this the rest of a long session runs with no card.
  // The working project is learned from touched paths since the last
  // compaction (context-check.mjs), so it is relearned after this one too.
  if (source === 'compact') { state.compactions = (state.compactions || 0) + 1; state.work = null; }
  if (source === 'compact' && !state.muted) {
    out.push(compactionFact(state), cardBody());
    const brief = briefNote(ctx, state, { force: true });
    if (brief) out.push(brief);
  }

  if (ctx.run) {
    const ex = resumeExcerpt(ctx.run.runMd);
    out.push(`[orchestrate · ${word}] run ${ctx.run.runMd}${ex ? `\n${ex}` : ' — nothing written under Goal or Pickup yet'}`);
  } else if (source === 'compact') {
    const ex = checkpointExcerpt(input.session_id);
    if (ex) out.push(`[orchestrate · compacted] checkpoint\n${ex}`);
  } else if (ctx.candidates.length) {
    out.push(`[orchestrate · ${word}] no run is bound to this session. ${ctx.runHow}. Candidates: ${ctx.candidates.map(c => c.runMd).join(', ')}. Bind one before a dispatch writes through it.`);
  }
  // A summary can paraphrase the goal away while the loop keeps going, and in an
  // unattended loop there may be no user prompt to bring it back. Restore it
  // verbatim here, the same moment the run excerpt is restored.
  if (state.persist && state.persist.armed) out.push(`[orchestrate · ${word}] ${persistLine(state.persist)}`);
  const lost = unreturnedNote(state, { native: stillRunningNative(input, state) });
  if (lost) out.push(lost);
  // After a compaction the reading starts over from the boundary. Usually that
  // says nothing until a response measures it; a summary that is itself huge
  // says so now.
  const size = contextLine(input, { force: true });
  if (size) out.push(size);
  const mode = modeNote(state, input);
  if (mode) out.push(mode);

  state.cardSent = true;
  state.lastStateHash = stateHash(ctx);
  state.lastActionable = actionableLine(ctx);
  saveSession(state);
  emit('SessionStart', out.join('\n'));
}

function maybePrune() {
  try {
    const stamp = join(dirname(sessionPath('x')), '.prune-stamp');
    const last = existsSync(stamp) ? statSync(stamp).mtimeMs : 0;
    if (Date.now() - last > 86400000) { pruneSessions(7); mkdirSync(dirname(stamp), { recursive: true }); writeFileSync(stamp, String(Date.now())); }
  } catch {}
}

// ---- CLI modes --------------------------------------------------------------
function showState() {
  const input = { session_id: 'cli', cwd: process.cwd() };
  const state = newState(input);
  const ctx = gatherContext(input, state);
  console.log(stateLine(ctx, '[orchestrate]'));
  console.log(cardBody());
  if (ctx.run) console.log(`\n[run ${ctx.run.runMd}]\n${resumeExcerpt(ctx.run.runMd)}`);
  console.log(`\ncard: ${cardBody().length} characters (cap ${CARD_CAP})`);
}

// The router's share of a session is one number, and it must not depend on
// which script you ask. measure.mjs owns the parsing, including the rule that a
// tool result quoting an injection is not an injection.
async function cost(path) {
  const { measure } = await import('./measure.mjs');
  const r = measure(readFileSync(path, 'utf8'));
  const read = r.input + r.cacheRead + r.cacheWrite;
  const tok = n => Math.round(n / 4);
  console.log(`router injections: ${r.routerInjections}`);
  console.log(`bytes injected once: ${r.routerBytes} (≈ ${tok(r.routerBytes)} tokens)`);
  console.log(`bytes re-read over later assistant turns: ${r.routerReread} (≈ ${tok(r.routerReread)} cache-read tokens, cumulative)`);
  console.log(`assistant turns with usage: ${r.turns}`);
  if (read) console.log(`share of everything the session read: ${((tok(r.routerBytes) + tok(r.routerReread)) / read * 100).toFixed(2)}%`);
  console.log('(measure.mjs on the same file gives the full report)');
}

// ---- main -------------------------------------------------------------------
// Guarded, so importing this file for a test does not run the hook.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--state') showState();
    else if (args[0] === '--cost' && args[1]) await cost(args[1]);
    else if (args[0] === '--prune') console.log(`pruned ${pruneSessions(7)} session file(s)`);
    else {
      let payload = '';
      try { payload = readFileSync(0, 'utf8'); } catch {}
      let input = null;
      try { input = JSON.parse(payload); } catch { input = null; }
      if (input && typeof input === 'object') {
        if (input.hook_event_name === 'UserPromptSubmit') handlePrompt(input);
        else if (input.hook_event_name === 'SessionStart') handleSessionStart(input);
      }
    }
  } catch {}
  process.exit(0);
}
