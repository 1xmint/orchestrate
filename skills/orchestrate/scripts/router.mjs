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
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectTier, routerSettings, agentsInstalled, findRepoRoot, resolveRun,
  loadSession, saveSession, sessionPath, pruneSessions, readTail, selfModel,
  DIR, readJson, writeJsonAtomic, FAMILY_ORDER, AGENT_NAMES,
  SESSIONS_DIR, PROFILE_PATH,
} from './lib/tier.mjs';
import { sampleContext, storedContext } from './lib/context-store.mjs';
import { readContext, idPart, countBoundaries } from './lib/context-scan.mjs';
import { writeCompactionSnapshot } from './lib/compaction-snapshot.mjs';
import { helperJustCompacted } from './lib/helper-compaction.mjs';
import { readGoal, goalLine, goalDue, markShown } from './lib/goal.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote } from './lib/workers.mjs';
import { LISTING_REPORT_PATH, LISTING_REPORT_MIN_TOKENS, pluginFitReport } from './lib/listing.mjs';
import { readQuota, resetClock, CAUTION_FIVE_HOUR, HELPER_STOP_FIVE_HOUR, limitsFromTail, scanLimits } from './lib/quota.mjs';
import { autocompactOffer, applyAutocompact, removeAutocompact, parseAutocompact } from './lib/settings.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { findPreviousSession } from './lib/handoff.mjs';
import { projectNote } from './lib/project.mjs';
import { CARD, CARD_CAP, cardBody, shortCard, compactNote, autocompactTip, autocompactOffNote } from './lib/card.mjs';
import { BRIEF_CAP, briefState, briefNote } from './lib/brief.mjs';
import {
  stillRunningNative, unreturned, unreturnedNote, STALE_SEEN_PATH, staleNote, compactionFact,
} from './lib/recover.mjs';
import { PERSIST_INTENT, syntheticPrompt, persistIntent, promptIntent, barePersistPhrase, GOAL_CAP, persistLine } from './lib/persist-words.mjs';
import { runOpenWork } from './lib/runs.mjs';
import {
  stateLine, statusReply, actionableLine, contextBand, contextPhrase, quotaPhrase, quotaBand,
  READY_SHOWN, readyPhrase, ungradedPhrase, budgetPhrase, progressPhrase, edgesPhrase, runPhrase,
  stateHash, codexState,
} from './lib/state-line.mjs';
import {
  RESUME_CAP, sectionExcerpt, resumeExcerpt, checkpointExcerpt, latestCheckpointFor,
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
export { PERSIST_INTENT, syntheticPrompt, persistIntent, promptIntent, barePersistPhrase, GOAL_CAP, persistLine };
export { limitsFromTail, LISTING_REPORT_PATH, LISTING_REPORT_MIN_TOKENS, PROFILE_PATH, pluginFitReport };

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- local context ----------------------------------------------------------
// The lead's own cost per step comes from the shared reader (lib/context-store.mjs),
// said only when its advice changes. A compaction starts a new epoch there, so
// advice given before it is never repeated against the compacted conversation.
// The window a size line quotes is only what the host reported for this
// conversation; the environment and settings.json move the plugin's own
// compact line but are never printed as the window.
// `minCompactions`: this hook runs before the host writes its compaction
// record, so a reading that has seen fewer compactions than that is the one
// from before the summary, and is not printed.
export function contextLine(input, { force = false, minCompactions = 0 } = {}) {
  try {
    if (!input || !input.transcript_path) return '';
    const o = { transcriptPath: input.transcript_path, session: input.session_id || null, force, settingsPath: join(dirname(DIR), 'settings.json'), env: process.env };
    if (minCompactions && (Number(sampleContext({ ...o, announce: false }).reading.compactions) || 0) < minCompactions) return '';
    return sampleContext(o).notice || '';
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
  return `[orchestrate · lead setting] this session runs ${self.model} at ${self.effort} effort on plan ${tier}. Effort multiplies the output and thinking of every step; on Opus 5, Anthropic measured medium at about 2 points below high for half the cost. A change takes effect in a new session; switching mid-session re-reads everything uncached.`;
}

// The id of the newest compaction boundary this hook can see in the transcript.
function newestBoundaryId(input) {
  try {
    const c = readContext(input.transcript_path, { session: input.session_id }).compaction;
    return c && c.uuid ? idPart(c.uuid) : null;
  } catch { return null; }
}

// A checkpoint file counts as this compaction's when its name carries the
// newest visible boundary's id and it was written in the last two minutes.
function checkpointIsFresh(path, boundaryId, now = Date.now()) {
  try {
    return Boolean(boundaryId) && basename(path).includes(boundaryId) && now - statSync(path).mtimeMs <= 120000;
  } catch { return false; }
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
const FIX_WORDS = /\b(fix|fixes|fixing|broken|bug|crash\w*|failing|fails)\b/i;

// "Small": one sentence (no sentence-ending punctuation before the very end),
// under about 15 words, and none of BUILD_WORDS. Called only once a prompt is
// already known to be substantive.
function isSmallPrompt(trimmed) {
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 15) return false;
  const withoutEnding = trimmed.replace(/[.!?]+\s*$/, '');
  // A mark inside a word (a file name, a version) does not end a sentence.
  if (/[.!?](\s|$)/.test(withoutEnding)) return false;
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
// A family is every helper's model only when the scope words hold the name
// itself: "however many opus agents", "opus for all the helpers", "every
// helper on opus". Scope words elsewhere in the sentence are about something
// else ("as many tests as you can, use opus for the parser fix"), and a
// sentence that also says not, only, except or this one is not a blanket yes.
// Wrong in the loose direction, every later helper runs on a model the user
// pays more for; wrong in the tight one, the guard asks again.
const HELPERS = '(?:agents?|helpers?|workers?|subagents?|tasks?)';
const runScope = f => new RegExp(
  `\\b(?:however|as) many (?:of (?:the |your )?)?${f}\\b` +
  `|\\b${f}\\b(?:[^.;,!?\\n]|\\.(?=\\d)){0,30}?\\b(?:for|on|to) (?:all|every|each)\\b(?: of)?(?: the| your| my)? ${HELPERS}\\b` +
  `|\\b(?:all|every|each)(?: of)?(?: the| your| my)? ${HELPERS} (?:on|use|uses|using|with|gets?|runs? on|should use) ${f}\\b`, 'i');
const NOT_BLANKET = /\b(?:stop|quit|no more|not|don'?t|never|only|except|this one|that one)\b/i;
// A sentence ends at ; or a line break, or . ! ? before a space: the dot in
// "opus 5.5" is part of the name.
const sentenceAt = (text, i) => {
  const parts = text.split(/(?<=[.!?])(?=\s)|(?<=[;\n])/);
  let at = 0;
  for (const p of parts) { if (i < at + p.length) return p; at += p.length; }
  return '';
};
export function runFamilyIn(text, families) {
  let best = null;
  for (const f of families) {
    const m = runScope(f).exec(text);
    const s = m && sentenceAt(text, m.index);
    // A question asks, it does not grant; a sentence that names sonnet or
    // haiku too splits the run between models. A missed grant costs one ask,
    // a wrong one costs the user money.
    if (!m || NOT_BLANKET.test(s) || /\?\s*$/.test(s) || /\b(?:sonnet|haiku)\b/i.test(s)) continue;
    if (!best || m.index < best.at) best = { family: f, at: m.index, sentence: s };
  }
  return best;
}
// Withdrawn by name ("stop using opus", "no more opus"), or by putting the
// helpers back on a cheaper model for the rest ("sonnet from now on").
const withdrawsRun = (text, f) =>
  new RegExp(`\\b(?:stop|quit|no more|don'?t|do not|never)\\b[^.;!?\\n]{0,20}\\b${f}\\b`, 'i').test(text)
  || /\b(?:sonnet|haiku)\b[^.;!?\n]{0,40}\b(?:from now on|for the rest|for all|for every|throughout)\b|\b(?:back to|switch to|only use) (?:sonnet|haiku)\b/i.test(text);

// The fact the lead needs when a grant covers the run, and the one part of
// the request it cannot honour: the Agent tool takes a model, not an effort,
// so "opus high" runs each helper at the host's default effort.
function runGrantLine(f, near) {
  const effort = /\b(?:effort|low|medium|high|xhigh|max)\b/i.test(near)
    ? ' A helper\'s effort cannot be set: it runs at the host\'s default for that model, so say so once if the user named one.' : '';
  return `[orchestrate · model] The user named ${f} for every helper this session; the guard allows it for any task without asking again.${effort}`;
}

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
const HOST_TAGS = /<(system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args)>[\s\S]*?<\/\1>/g;

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

  // The host's own tagged text around what the user typed (the desktop app's
  // folder notice in a system-reminder, a slash command's caveat and echo) is
  // cut out first: none of it is the user's words, and once it was pinned as
  // the goal.
  const trimmed = text.replace(HOST_TAGS, ' ').trim();

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
  // A family named for every helper ("however many opus agents you need") is
  // its own record, `runModel`, beside the one-task grant: seen live, the
  // owner said that and each helper after the first was refused back to
  // Sonnet. The one-task grant goes to the earliest other family named.
  let runGrant = null;
  if (state.runModel && withdrawsRun(trimmed, state.runModel.family)) {
    runGrant = `[orchestrate · model] The user withdrew ${state.runModel.family} for every helper; helpers start on Sonnet again, and a model they name covers one task.`;
    delete state.runModel;
  }
  const run = runFamilyIn(trimmed, grantFamilies);
  if (run && !(state.runModel && state.runModel.family === run.family)) {
    state.runModel = { family: run.family, at: new Date().toISOString() };
    runGrant = runGrantLine(run.family, run.sentence);
  }
  let namedFamily = null, namedAt = Infinity;
  for (const f of grantFamilies) {
    if (run && f === run.family) continue;
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
  let ctx = null;
  const getCtx = () => ctx || (ctx = gatherContext(input, state));
  const intent = state.persistMuted ? null : promptIntent(trimmed);
  const explicit = !state.persistMuted && intent !== 'status' && persistIntent(trimmed);
  if (explicit) {
    // A bare "keep going" or "continue until complete" names no goal; it means
    // the one already pinned or the open run's, never the phrase itself.
    const prior = state.persist && state.persist.goal;
    const g = readGoal({ cwd: input.cwd, root: getCtx().repoRoot, session: input.session_id, runMd: getCtx().run && getCtx().run.runMd, state });
    let goal = trimmed.slice(0, 4000), goalSource = 'prompt';
    if (barePersistPhrase(trimmed) || (prior && trimmed.split(/\s+/).length < 4)) {
      if (prior) { goal = prior; goalSource = state.persist.goalSource || 'prompt'; }
      else if (g && g.source === 'ledger') { goal = g.text; goalSource = 'ledger'; }
      else { goal = ''; goalSource = 'none'; }
    }
    state.persist = { armed: true, goal, goalSource, armedAt: new Date().toISOString(), sizeAtArm: transcriptSize(input.transcript_path) };
    armedNow = true;
  } else if (intent === 'resume') {
    // The gate: the goal comes from an open run's ledger, that run says what
    // done looks like, and a task is not done. A project page's purpose is not
    // a finish line, so it never arms this.
    const run = getCtx().run;
    const g = run && readGoal({ cwd: input.cwd, root: getCtx().repoRoot, session: input.session_id, runMd: run.runMd, state });
    let work = null;
    if (g && g.source === 'ledger') { try { work = runOpenWork(readFileSync(run.runMd, 'utf8')); } catch { work = null; } }
    if (work && work.doneWhen && work.notDone > 0) {
      state.persist = { armed: true, goal: g.text, goalSource: 'ledger', armedAt: new Date().toISOString(), sizeAtArm: transcriptSize(input.transcript_path) };
      armedNow = true;
    }
  } else if (intent === 'retry' && state.persist && state.persist.armedAt) {
    // Restores keep-going that was on before the stop; never starts it.
    const { endedAt, endReason, ...rest } = state.persist;
    state.persist = { ...rest, armed: true, armedAt: new Date().toISOString(), sizeAtArm: transcriptSize(input.transcript_path) };
    armedNow = true;
  }
  if (state.muted) { saveSession(state); return; }

  // A slash command, a paste or a two-word reply is not the start of a session's
  // work, and the card is worth its tokens only on something substantive.
  // A short request that names building or fixing ("migrate to postgres",
  // "fix login properly") is the start of work whatever its length.
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const substantive = !/^\s*\//.test(trimmed) && !/```/.test(trimmed)
    && (wordCount >= 4 || (wordCount >= 2 && (BUILD_WORDS.test(trimmed) || FIX_WORDS.test(trimmed))));

  // What this session is for, recorded once so a later session in the same
  // folder can answer "continue what?" for itself.
  if (substantive && !state.goal && !barePersistPhrase(trimmed)) state.goal = trimmed.replace(/\s+/g, ' ').trim().slice(0, 300);

  getCtx();
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
      out.push(`Only ${ctx.agents} of the plugin's ${ctx.agentsExpected} helper roles are installed; type \`claude plugin install orchestrate@orchestrate\` to finish.`);
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
  // The project page answers "continue what?" when there is one; only without
  // it does the previous session's own words stand in.
  if (freshSession && !state.handoffShown && continueIntent(trimmed)) {
    const page = projectNote(ctx.repoRoot, input.cwd);
    if (page) { out.push(page); state.projectShown = true; markShown(state, substantive ? 1 : 0); }
    else {
      const prev = findPreviousSession({ sessionsDir: SESSIONS_DIR, cwd: input.cwd, exceptId: input.session_id, now: Date.now() });
      if (prev) out.push(handoffLine(prev, ctx));
    }
    state.handoffShown = true;
  }

  // The project page, once per session at its first real request: it is the one
  // place the plan and the purpose live, so it is in view from the start.
  if (substantive && freshSession && !state.projectShown) {
    const page = projectNote(ctx.repoRoot, input.cwd);
    if (page) { out.push(page); state.projectShown = true; markShown(state, 1); }
  }

  // Said once, after the state line rather than before it: a question, not a
  // notice — nothing is written until the user types the command back. The
  // offer is decided and marked spent right here, on the first substantive
  // prompt, but its screen time waits for the second one — the session's
  // opening prompt already carries the card and (often) an install or brief
  // note, and the first payload in a fresh home has a byte budget of its own.
  if (substantive) {
    if (offer.offer) {
      if (freshSession) state.autocompactTipPending = offer.value;
      else out.push(autocompactTip(offer.value));
    } else if (state.autocompactTipPending != null) {
      out.push(autocompactTip(state.autocompactTipPending));
      state.autocompactTipPending = null;
    }
  }

  if (substantive) {
    const brief = briefNote(ctx, state);
    if (brief) out.push(brief);
  }

  // What a usage band means for the next choice, said once per band.
  const band = quotaBand(ctx.quota);
  if (band !== (state.quotaBand || 'none') && (band === 'caution' || band === 'stop')) {
    const h = ctx.quota.fiveHour;
    out.push(band === 'stop'
      ? `[orchestrate · usage] the 5-hour window is at ${Math.round(h.pct)}% (resets ${resetClock(h.resetsAt)}). No new helpers will start.`
      : `[orchestrate · usage] the 5-hour window is at ${Math.round(h.pct)}%.`);
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

  if (runGrant) out.push(runGrant);

  if (armedNow) {
    out.push(`[orchestrate · persist] ${persistLine(state.persist)}`);
    // The existing budget and readiness machinery only engages for a run. Point
    // at it once, for work big enough to deserve it, rather than rebuild it.
    if (!ctx.run) out.push('If this goal is several separable tracks, or will outlive this session, open a run first (run-init.mjs) so readiness is tracked; for direct work, just start.');
  }

  // The goal, as one fact, on every tenth prompt since it was last shown; on the
  // others nothing is added. Compaction and resume show it in handleSessionStart.
  // With a project page the goal line is not repeated: the page is re-shown at
  // the moments that matter and keeps the purpose in view.
  if (substantive && goalDue(state) && !projectNote(ctx.repoRoot, input.cwd)) {
    const g = readGoal({ cwd: input.cwd, root: ctx.repoRoot, session: input.session_id, runMd: ctx.run && ctx.run.runMd, state });
    if (g) { out.push(goalLine(g)); markShown(state, 1); }
  }

  if (substantive) state.prompts++;
  saveSession(state);
  maybePrune();
  emit('UserPromptSubmit', out.join('\n'));
}

// The compaction number this hook announces, read from the lead transcript's
// own boundary records instead of a counter any compaction hook can bump (a
// helper's compaction has reached the lead with no agent_id). This hook runs
// before the host writes the new boundary — on both live transcripts checked
// the hook's record is stamped 0.4 to 0.6 s before its boundary's — so the
// boundaries on file are the earlier compactions and this one is one more.
// A hook that finds no boundary beyond the last one counted is not a new
// compaction of the lead: the number stays. No readable transcript: +1, as before.
export function nextCompactions(state, transcriptPath) {
  const before = state.compactions || 0;
  const seen = transcriptPath ? countBoundaries(transcriptPath) : null;
  if (seen == null) return before + 1;
  const last = state.boundariesCounted;
  state.boundariesCounted = seen;
  if (last === seen && before > 0) return before;
  return seen + 1;
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
  // The same, when the host dropped the agent_id (#91910): a helper that
  // compacted seconds ago. Before any state is loaded, so its compaction
  // neither bumps the lead's count nor clears the lead's working project.
  if (source === 'compact' && helperJustCompacted(input)) return;

  const state = loadSession(input.session_id) || newState(input);
  const ctx = gatherContext(input, state);
  const out = [];
  const word = source === 'resume' ? 'resumed' : 'compacted';

  // The summary keeps the conversation's gist, not the card that was injected
  // into it, so without this the rest of a long session runs with no card.
  // The working project is learned from touched paths since the last
  // compaction (context-check.mjs), so it is relearned after this one too.
  if (source === 'compact') { state.compactions = nextCompactions(state, input.transcript_path); state.work = null; }
  // Write the plugin's own checkpoint before anything below names it, so the
  // compacted line names the file whichever hook ran first — this one, or
  // postcompact-check.mjs on the lead side. Idempotent and silent on error.
  let snapshotPath = null;
  if (source === 'compact') {
    try {
      const reading = readContext(input.transcript_path, { session: input.session_id });
      snapshotPath = writeCompactionSnapshot({
        session: input.session_id, reading, transcriptPath: input.transcript_path,
        ctx: { runMd: ctx.run && ctx.run.runMd, runDir: ctx.run && ctx.run.dir, cwd: input.cwd },
      });
    } catch { snapshotPath = null; }
  }
  if (source === 'compact' && !state.muted) {
    out.push(compactionFact(state), cardBody());
    const brief = briefNote(ctx, state, { force: true });
    if (brief) out.push(brief);
  }

  if (ctx.run) {
    const ex = resumeExcerpt(ctx.run.runMd);
    out.push(`[orchestrate · ${word}] run ${ctx.run.runMd}${ex ? `\n${ex}` : ' — nothing written under Goal or Pickup yet'}`);
  } else if (source === 'compact') {
    // Name the file, never inject its text: one line naming the path is the
    // whole context cost of a compaction; the lead reads the file when it
    // needs it. `latestCheckpointFor` finds whichever checkpoint is newest —
    // the plugin's own snapshot just written, or one the lead wrote itself.
    // The host writes the boundary record after this hook, so the newest
    // boundary visible here can be the previous compaction's. The path is
    // named only when it belongs to that boundary and was written in the last
    // two minutes; otherwise the note is promised for the first action.
    const cp = snapshotPath || latestCheckpointFor(input.session_id);
    out.push(`[orchestrate · compacted] ${cp && checkpointIsFresh(cp, newestBoundaryId(input)) ? `checkpoint: ${cp}` : 'checkpoint note follows at first action'}`);
  } else if (ctx.candidates.length) {
    out.push(`[orchestrate · ${word}] no run is bound to this session. ${ctx.runHow}. Candidates: ${ctx.candidates.map(c => c.runMd).join(', ')}. Bind one before a dispatch writes through it.`);
  }
  // The goal, once: an open run's excerpt above already printed its Goal and Done
  // when, so only without a run is it added here.
  if (!state.muted) {
    // The project page when there is one, with or without a run; else the old
    // sources below.
    const page = projectNote(ctx.repoRoot, input.cwd);
    if (page) { out.push(page); state.projectShown = true; markShown(state); }
    else if (ctx.run) markShown(state);
    else {
      const g = readGoal({ cwd: input.cwd, root: ctx.repoRoot, session: input.session_id, state });
      if (g) { out.push(goalLine(g)); markShown(state); }
    }
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
  const size = contextLine(input, { force: true, minCompactions: source === 'compact' ? state.compactions : 0 });
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
