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
// Never blocks, never rewrites input, never exits non-zero. No network, no
// child processes.
//
//   echo '<hook json>' | node router.mjs          hook mode (stdin)
//   node router.mjs --state                       what it would inject, no writes
//   node router.mjs --cost <transcript.jsonl>     what the router cost that session
//   node router.mjs --prune                       delete session state older than 7 days

import { readFileSync, existsSync, unlinkSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectTier, routerSettings, agentsInstalled, findRepoRoot, resolveRun,
  loadSession, saveSession, sessionPath, pruneSessions, readTail, selfModel,
  DIR, readJson, writeJsonAtomic, FAMILY_ORDER, AGENT_NAMES,
  SESSIONS_DIR,
} from './lib/tier.mjs';
import { sampleContext, storedContext } from './lib/context.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote } from './lib/workers.mjs';
import { readHead, parseListing, pluginNames, pluginFitLine, tokens } from './lib/listing.mjs';
import { readQuota, resetClock, CAUTION_FIVE_HOUR, HELPER_STOP_FIVE_HOUR } from './lib/quota.mjs';
import { autocompactOffer, applyAutocompact, removeAutocompact, parseAutocompact } from './lib/settings.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { findPreviousSession } from './lib/handoff.mjs';
import { CARD, CARD_CAP, cardBody, compactNote, autocompactTip, autocompactOffNote } from './lib/card.mjs';
import { BRIEF_CAP, briefState, briefNote } from './lib/brief.mjs';
import {
  stillRunningNative, unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact,
} from './lib/recover.mjs';
import {
  stateLine, statusReply, actionableLine, contextBand, contextPhrase, quotaPhrase, quotaBand,
  READY_SHOWN, readyPhrase, ungradedPhrase, budgetPhrase, progressPhrase, edgesPhrase, runPhrase,
  stateHash, codexState,
} from './lib/state-line.mjs';
import {
  RESUME_CAP, sectionExcerpt, resumeExcerpt, checkpointExcerpt,
  handoffLine, continueIntent, CONTINUE_WORD,
} from './lib/resume.mjs';

export { CARD, CARD_CAP, cardBody, compactNote };
export {
  stateLine, statusReply, actionableLine, contextBand, contextPhrase, quotaPhrase, quotaBand,
  READY_SHOWN, readyPhrase, ungradedPhrase, budgetPhrase, progressPhrase, edgesPhrase, runPhrase,
  stateHash, codexState,
};
export { RESUME_CAP, sectionExcerpt, resumeExcerpt, checkpointExcerpt, handoffLine, continueIntent, CONTINUE_WORD };
export { BRIEF_CAP, briefState, briefNote };
export { cappedNote };
export { unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact };

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- local context ----------------------------------------------------------
// Only the host's own limit messages count: they arrive as assistant records
// with the model "<synthetic>". Matching the phrase anywhere in the tail
// counted a research report that quoted it, and told the lead the user had hit
// two limits they had not. "Today" means today: the set resets with the date.
export function limitsFromTail(tail) {
  const found = new Set();
  for (const l of String(tail || '').split('\n')) {
    if (!l.includes('<synthetic>') && !l.includes('isApiErrorMessage')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o && o.type === 'assistant' && o.message;
    if (!m || !(m.model === '<synthetic>' || o.isApiErrorMessage)) continue;
    const text = (Array.isArray(m.content) ? m.content : []).map(b => (b && b.text) || '').join(' ');
    for (const hit of text.matchAll(/hit your (Opus|Sonnet|Haiku|Fable) limit/gi)) found.add(hit[1].toLowerCase());
    if (/hit your (session|weekly) limit/i.test(text)) found.add('session');
  }
  return found;
}

function scanLimits(transcriptPath, state) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (state.limitsDay !== day || state.limitsV !== 2) { state.limits = []; state.limitsDay = day; state.limitsV = 2; state.limitsScanMtime = null; }
    if (!transcriptPath || !existsSync(transcriptPath)) return state.limits;
    const mt = statSync(transcriptPath).mtimeMs;
    if (state.limitsScanMtime === mt) return state.limits;
    const found = new Set([...state.limits, ...limitsFromTail(readTail(transcriptPath, 65536))]);
    state.limitsScanMtime = mt;
    return [...found];
  } catch { return state.limits || []; }
}

// The lead's own cost per step comes from the shared reader (lib/context.mjs),
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

  return {
    tier: state.tier,
    agents: agentsInstalled().installed,
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

// ---- persistence intent -----------------------------------------------------
// The one place this file still reads wording, kept deliberately narrow: an
// explicit ask to keep going toward a goal, never the shape of the work. A
// false arm is cheap, because persist-check.mjs stops on the first step that
// does no work. A question never arms it, and "persist off" turns it off for
// the session.
export const PERSIST_INTENT = /\b(keep (going|coding|working|building|at it)|don'?t stop|until (it'?s |it is |they'?re |the [\w-]+( [\w-]+)? (is|are) |everything is |all (of it |of them )?(is |are )?)?(done|finished|complete|working|green|passing|shipped|live)\b|(execute|implement|carry out|work through|finish) (the|this|that|my) (whole |full |entire |rest of the )?(plan|roadmap|spec|checklist|task list|todo list|backlog)|finish (it|everything|all of it|the rest)\b|build (out )?the (whole|entire|full) )/i;

// A prompt the host or another Claude session wrote, not the user typing:
// a background task's completion notice, a helper's hand-back, or a message
// relayed from another session. The text is the only signal the hook payload
// carries for this. Checked against the first non-blank line, because a
// hand-back's own marker line ("[Subagent hand-back]") sometimes follows an
// opening `<agent-message ...>` tag rather than starting the prompt.
// Seen live: a finished helper's hand-back became the persist goal.
const SYNTHETIC_OPEN = /^\s*(\[SYSTEM NOTIFICATION - NOT USER INPUT\]|<task-notification>|<agent-message|\[Subagent hand-back\]|Another Claude session sent a message|<ci-monitor-event>)/i;

export function syntheticPrompt(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const second = lines[1] || '';
  return SYNTHETIC_OPEN.test(first) || /^\[Subagent hand-back\]/i.test(second);
}

export function persistIntent(text) {
  const t = String(text || '').trim();
  if (!t || /\?\s*$/.test(t)) return false;
  return PERSIST_INTENT.test(t);
}

export const GOAL_CAP = 600;

export function persistLine(persist) {
  if (!persist || !persist.armed) return '';
  const g = String(persist.goal || '').replace(/\s+/g, ' ').trim();
  return `auto-continue is on toward: "${g.length > GOAL_CAP ? `${g.slice(0, GOAL_CAP - 3)}...` : g}". A Stop is refused while each step does real work; it ends when you say the goal is met, ask the user something, a dispatch is denied, the same error repeats, a step does nothing, or after 25 steps. Waiting on CI or an agent: Monitor it and keep doing independent work. "persist off" turns it off.`;
}

function transcriptSize(p) {
  try { return p ? statSync(p).size : 0; } catch { return 0; }
}

function newState(input) {
  return {
    v: 1, session_id: input.session_id || 'unknown', cwd: input.cwd || '',
    started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false,
    lastPromptId: null, lastStateHash: null, limits: [],
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

  const freshSession = !state.cardSent;
  if (!state.cardSent && substantive) {
    const opening = actionableLine(ctx);
    out.push(opening ? `[orchestrate] ${opening}` : '[orchestrate]');
    out.push(cardBody());
    if (ctx.run) {
      const ex = resumeExcerpt(ctx.run.runMd);
      if (ex) out.push(`[orchestrate · run ${ctx.run.runMd}]\n${ex}`);
    }
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

export const LISTING_REPORT_PATH = join(DIR, 'listing-report.json');
export const LISTING_REPORT_MIN_TOKENS = 4000;
export const PROFILE_PATH = join(DIR, 'profile.json');

// Machine-wide, not per session: the plugins are the same in every session. The
// full check is said the first time the listings are seen, and after that only
// when plugins are added — a reminder of a choice the user already made is
// noise, and a plugin they just installed is the moment its fit matters. A small
// setup gets no full check. The stamp is written only once the listings were
// actually read, so a session whose listings are not in the transcript yet tries
// again on its next prompt.
export function pluginFitReport(transcriptPath, { path = LISTING_REPORT_PATH, profilePath = PROFILE_PATH, now = Date.now() } = {}) {
  try {
    if (!transcriptPath) return '';
    const l = parseListing(readHead(transcriptPath));
    if (!l.found) return '';
    const stamp = readJson(path);
    const known = stamp && Array.isArray(stamp.plugins) ? stamp.plugins : null;
    const names = pluginNames(l);
    if (known && names.length === known.length && names.every(p => known.includes(p))) return '';
    writeJsonAtomic(path, { at: now, plugins: names });
    if (!known && tokens(l.skillChars + l.toolChars + l.serverChars) < LISTING_REPORT_MIN_TOKENS) return '';
    const profile = readJson(profilePath) || {};
    return pluginFitLine(l, {
      known,
      paidMode: profile.paidServices || 'ask',
      paidAllowed: Array.isArray(profile.paidAllowed) ? profile.paidAllowed : [],
      profileScript: join(SKILL_DIR, 'scripts', 'profile.mjs'),
    });
  } catch { return ''; }
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
