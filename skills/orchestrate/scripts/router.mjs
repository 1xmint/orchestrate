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
} from './lib/tier.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- the card (from references/ladder.md, so the text has one home) ---------
// Four short paragraphs: how the work is shaped, when a question is worth a
// search, what always stops and asks, and how to mute this. No rung numbers and
// no agent names, because nothing here has read the work.
const FALLBACK_CARD = [
  'orchestrate is loaded. Do ordinary bounded work yourself. Delegate a substantial separable task when isolation, parallel progress, a specialist, or independent scrutiny buys something concrete. Open a run ledger when several tracks run at once or the work outlives this session.',
  'Before adding a dependency, an abstraction or another worker, name the unresolved problem it solves now. A future possibility is not one.',
  'Stop and ask, with a recommendation first, only for money, a public surface, credentials, or a destructive or irreversible action. Existing authorisation is not asked for twice.',
  'Mute: type "router off".',
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
  const agents = `orch-agents ${ctx.agents}/6`;
  const limits = ctx.limits.length ? `limits today: ${ctx.limits.join(', ')}` : 'limits today: none';
  return `${prefix} ${you} · tier ${ctx.tier} · ${agents} · ${runPhrase(ctx)} · ${limits}`;
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

function runPhrase(ctx) {
  if (ctx.run) return `run: ${ctx.run.runId} (${ctx.runHow})${ungradedPhrase(ctx.run)}${readyPhrase(ctx.run)}`;
  if (ctx.candidates.length === 1) return `run: none bound; one candidate, ${ctx.candidates[0].runMd}`;
  if (ctx.candidates.length > 1) return `run: none bound; ${ctx.candidates.length} candidates in this repo`;
  return 'run: none';
}

export function stateHash(ctx) {
  return [
    ctx.tier, ctx.agents, ctx.run ? ctx.run.runId : '', ctx.candidates.length,
    // A task becoming ready is the moment the line is worth reprinting, and the
    // moment a waiting lead has something better to do. A return landing, or a
    // row finally being set, is the same kind of moment.
    ctx.run && ctx.run.ready ? ctx.run.ready.join(',') : '',
    ctx.run && ctx.run.ungraded ? ctx.run.ungraded.join(',') : '',
    ctx.limits.join(','), ctx.self ? `${ctx.self.model}/${ctx.self.effort}` : '',
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

// ---- local context ----------------------------------------------------------
function scanLimits(transcriptPath, state) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return state.limits || [];
    const mt = statSync(transcriptPath).mtimeMs;
    if (state.limitsScanMtime === mt) return state.limits || [];
    const tail = readTail(transcriptPath, 65536);
    const found = new Set(state.limits || []);
    for (const m of tail.matchAll(/hit your (Opus|Sonnet|Haiku|Fable) limit/gi)) found.add(m[1].toLowerCase());
    if (/hit your (session|weekly) limit/i.test(tail)) found.add('session');
    state.limitsScanMtime = mt;
    return [...found];
  } catch { return state.limits || []; }
}

function gatherContext(input, state) {
  if (!state.tier) { const t = detectTier(); state.tier = t.tier; state.tierSource = t.source; }
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
  };
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
  if (state.muted) { saveSession(state); return; }

  // A slash command, a paste or a two-word reply is not the start of a session's
  // work, and the card is worth its tokens only on something substantive.
  const substantive = !/^\s*\//.test(trimmed) && !/```/.test(trimmed) && trimmed.split(/\s+/).length >= 4;
  const ctx = gatherContext(input, state);
  const out = [];

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

  if (substantive) state.prompts++;
  saveSession(state);
  maybePrune();
  emit('UserPromptSubmit', out.join('\n'));
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
  } else if (ctx.candidates.length) {
    out.push(`[orchestrate · ${word}] no run is bound to this session. ${ctx.runHow}. Candidates: ${ctx.candidates.map(c => c.runMd).join(', ')}. Bind one before a dispatch writes through it.`);
  }

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
