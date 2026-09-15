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

import { readFileSync, existsSync, unlinkSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectTier, routerSettings, agentsInstalled, findRepoRoot, resolveRun,
  loadSession, saveSession, sessionPath, pruneSessions, readTail, selfModel,
  DIR, readJson, writeJsonAtomic, staleRunsUnder,
} from './lib/tier.mjs';
import { sampleContext, storedContext, CONTEXT_DIR, thresholds } from './lib/context.mjs';
import { modeNote } from './lib/modes.mjs';
import { cappedNote } from './lib/workers.mjs';
import { readHead, parseListing, pluginNames, pluginFitLine, tokens } from './lib/listing.mjs';
import { normalizeRole } from './lib/prices.mjs';
import { readQuota, resetClock, CAUTION_FIVE_HOUR, HELPER_STOP_FIVE_HOUR } from './lib/quota.mjs';
import { applyAutocompactDefault } from './lib/settings.mjs';
import { loadPolicy } from './lib/policy.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

// ---- the card (from references/ladder.md, so the text has one home) ---------
// Five short paragraphs: how the work is shaped, how a question is answered,
// when a dependency or a worker earns its cost, what evidence decides done,
// and what always stops and asks. No rung numbers and no agent names, because
// nothing here has read the work.
// Kept byte-identical to the fenced card in references/ladder.md — see the
// drift test in router.test.mjs. This copy is the fallback for the rare case
// the file cannot be read; it used to be a shorter, separately-maintained
// summary that silently fell two paragraphs behind the real card.
export const FALLBACK_CARD = [
  'orchestrate is loaded. Your context is for judgment. Do a step yourself when it fits in about 8 tool calls with small outputs. Everything else goes to a worker, and you keep only its return: writing a file over ~150 lines, changing three or more files, a build or test suite, a read whose answer is a paragraph. Workers run on Codex (codex-worker.mjs --model --effort) until it runs out; Claude workers for what Codex cannot reach. A plan: one packet per step; three or more independent steps go to orch-coordinator. Never Write a file you could Edit, never Read back what you wrote; filter output. Open a run ledger when several tracks run at once or the work outlives this session.',
  'Answer a settled question from the record and say where. Answer a question about the world from the source that settles it. Answer a judgment question with a recommendation and what would change it. An installed skill that does what a built-in tool cannot beats rebuilding it; name it in any packet that needs it.',
  'Before adding a dependency, an abstraction or another worker, name the problem it solves now.',
  'Evidence decides done: reuse a check that passed, test a real uncovered behaviour, drive a user flow when reading cannot settle it. Independent review is for money, auth, destructive data, a contract others consume, or real architectural doubt.',
  'Stop and ask, recommendation first, only for money, a public surface, credentials, or a destructive or irreversible action. Authorisation already given is not asked for twice. Mute this card: type "router off".',
].join('\n');

export const CARD_CAP = 1550;

export function cardBody() {
  try {
    const md = readFileSync(join(SKILL_DIR, 'references', 'ladder.md'), 'utf8');
    const m = /```card\s*\n([\s\S]*?)\n```/.exec(md);
    if (m && m[1].trim()) return m[1].trim();
  } catch {}
  return FALLBACK_CARD;
}

// ---- state ------------------------------------------------------------------
export function stateLine(ctx, prefix) {
  const you = ctx.self && ctx.self.model
    ? `you: ${ctx.self.model}${ctx.self.effort ? ` @ ${ctx.self.effort} effort` : ''}`
    : 'you: model not known here';
  const agents = `orch-agents ${ctx.agents}/7`;
  const limits = (ctx.limits.length ? `limits today: ${ctx.limits.join(', ')}` : 'limits today: none') + contextPhrase(ctx.context);
  return `${prefix} ${you} · tier ${ctx.tier} · ${agents} · codex: ${ctx.codex || codexState()} · ${runPhrase(ctx)} · ${limits}${quotaPhrase(ctx.quota)}${ctx.persist ? ' · auto-continue on' : ''}`;
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

function runPhrase(ctx) {
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

// A bounded excerpt of what the run is for, for a session that has lost the
// thread: resumed, compacted, or picking up someone else's ledger. Outcome,
// constraints, current approach and the Pickup line — never the task history,
// which is long, mostly finished, and already on disk.
export const RESUME_CAP = 1200;

export function resumeExcerpt(runMd, cap = RESUME_CAP) {
  let text = '';
  try { text = readFileSync(runMd, 'utf8'); } catch { return ''; }
  const section = name => {
    const re = new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?:\\n## |\\s*$)`);
    const m = re.exec(text);
    if (!m) return '';
    const body = m[1].split('\n').filter(l => l.trim() && !/^<.*>$/.test(l.trim())).join('\n').trim();
    return body ? `${name}: ${body}` : '';
  };
  const parts = ['Goal', 'Done when', 'Constraints and non-goals', 'Approach', 'Decisions', 'Pickup']
    .map(section).filter(Boolean);
  let out = parts.join('\n');
  if (out.length > cap) out = `${out.slice(0, cap - 3)}...`;
  return out;
}

export function checkpointExcerpt(session, cap = RESUME_CAP) {
  try {
    const dir = join(CONTEXT_DIR, String(session || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120));
    const paths = readdirSync(dir).filter(n => /^checkpoint-.*\.md$/.test(n)).map(n => join(dir, n));
    const path = paths.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!path) return '';
    const text = readFileSync(path, 'utf8').trim();
    return text.length > cap ? `${text.slice(0, cap - 3)}...` : text;
  } catch { return ''; }
}

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
  if (/^router (off|on)$/i.test(trimmed)) { state.muted = /off$/i.test(trimmed); saveSession(state); return; }
  if (/^persist (off|on)$/i.test(trimmed)) {
    const off = /off$/i.test(trimmed);
    state.persistMuted = off;
    if (off && state.persist) state.persist = { ...state.persist, armed: false, endedAt: new Date().toISOString(), endReason: 'the user said persist off' };
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
  const ctx = gatherContext(input, state);
  const out = [];
  // Plugin settings cannot carry env vars.  Do this once, before the normal
  // card logic; after the marker exists this only stats one tiny file.
  const compact = applyAutocompactDefault({
    settingsPath: join(dirname(DIR), 'settings.json'), markerDir: DIR, policy: loadPolicy(),
  });
  if (compact.applied) out.push(`orchestrate set auto-compact to ${compact.value % 1000 ? compact.value : `${compact.value / 1000}k`} in ~/.claude/settings.json (it applies from the next session; backup at ${compact.backup || 'none'}). To undo: \`profile.mjs --autocompact off\`.`);
  // The mode the host reports, on every prompt: a switch into or out of Plan
  // mode is said once, whatever the prompt looks like.
  const mode = modeNote(state, input);
  if (mode) out.push(mode);

  if (!state.cardSent && substantive) {
    out.push(stateLine(ctx, '[orchestrate]'));
    out.push(cardBody());
    if (ctx.run) {
      const ex = resumeExcerpt(ctx.run.runMd);
      if (ex) out.push(`[orchestrate · run ${ctx.run.runMd}]\n${ex}`);
    }
    state.cardSent = true;
    state.lastStateHash = stateHash(ctx);
  } else if (substantive) {
    const hash = stateHash(ctx);
    if (state.lastStateHash && hash !== state.lastStateHash) out.push(stateLine(ctx, '[orchestrate · changed]'));
    state.lastStateHash = hash;
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
      const lost = unreturnedNote(state);
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

// Dispatches with no matching return. Matched in order, by role and, when both
// sides carry one, by task id. Said only at the moments work may have died —
// a resume, a compaction, a usage limit — because a helper still running looks
// exactly the same from here.
export function unreturned(state) {
  const returns = (state && Array.isArray(state.returned) ? state.returned : []).map(r => ({ ...r, used: false }));
  const out = [];
  for (const d of (state && Array.isArray(state.dispatches) ? state.dispatches : [])) {
    const role = normalizeRole(d.agent);
    const hit = returns.find(r => !r.used && r.agent === role && (!d.task || !r.task || r.task === d.task));
    if (hit) hit.used = true;
    else out.push({ role, task: d.task || d.key || null, progress: d.progress || null, at: d.at });
  }
  return out;
}

export function unreturnedNote(state, max = 5) {
  const list = unreturned(state);
  if (!list.length) return '';
  const shown = list.slice(-max).map(u => `${u.role}${u.task ? ` ${u.task}` : ''}${u.progress ? ` — progress ${u.progress}` : ' — no PROGRESS file named'}`).join('; ');
  return `[orchestrate · recover] ${list.length} helper${list.length === 1 ? '' : 's'} dispatched this session never returned: ${shown}. If one was stopped by a limit or the session ending, continue it with a fresh dispatch from its PROGRESS file and its branch; resuming the stopped agent re-reads its whole context at full price.`;
}

// Helpers that stopped at their turn cap (lib/workers.mjs), said once each.
export { cappedNote };

// Plans set aside as stale, said once per plan on this machine, so a user who
// wanted one back knows the one command, and nobody is told twice.
export const STALE_SEEN_PATH = join(DIR, 'stale-announced.json');

export function staleNote(repoRoot, path = STALE_SEEN_PATH, now = Date.now()) {
  if (!repoRoot) return '';
  try {
    const seen = readJson(path) || {};
    const fresh = staleRunsUnder(repoRoot).filter(r => !seen[r.runMd]);
    if (!fresh.length) return '';
    for (const r of fresh) seen[r.runMd] = now;
    writeJsonAtomic(path, seen);
    const days = r => Math.max(2, Math.round((now - r.lastActivity) / 86400000));
    const list = fresh.map(r => `${r.runId} (untouched ${days(r)} days, ${r.done}/${r.rows} done)`).join(', ');
    return `[orchestrate · plans] set aside ${fresh.length === 1 ? 'a plan' : `${fresh.length} plans`} nobody has touched in two days or more: ${list}. They are not bound, reported or filed into. If the user wants one back: node "${join(SKILL_DIR, 'scripts', 'run-init.mjs')}" --reopen <id>.`;
  } catch { return ''; }
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
  if (!routerSettings().enabled) return;
  const source = input.source || 'startup';
  if (source === 'clear') { try { unlinkSync(sessionPath(input.session_id)); } catch {} return; }
  if (source === 'startup') { pruneSessions(7); return; }
  if (source !== 'resume' && source !== 'compact') return;

  const state = loadSession(input.session_id) || newState(input);
  const ctx = gatherContext(input, state);
  const out = [];
  const word = source === 'resume' ? 'resumed' : 'compacted';

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
  const lost = unreturnedNote(state);
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
