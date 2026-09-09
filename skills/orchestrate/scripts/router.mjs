#!/usr/bin/env node
// router.mjs — the per-message router. A UserPromptSubmit + SessionStart hook
// that tells the model, once per session, the cost-ordered ladder of moves and
// the local state it cannot see (plan tier, an open run, installed agents, a
// model-family limit hit today), then stays silent unless a confident, changed
// classification or a state change gives it something short to say.
//
// Registered globally by `install.mjs --with-router`. Never blocks, never
// rewrites input, never exits non-zero. No network, no child processes.
//
//   echo '<hook json>' | node router.mjs          hook mode (stdin)
//   node router.mjs --explain "<prompt>"          features and rung, no state writes
//   node router.mjs --cost <transcript.jsonl>     what the router cost that session
//   node router.mjs --prune                        delete session state older than 7 days

import { readFileSync, existsSync, unlinkSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectTier, routerSettings, agentsInstalled, findRepoRoot,
  latestRun, loadSession, saveSession, sessionPath, pruneSessions, readTail, applyLimits, sanitizeId,
  selfModel, strongerThan,
} from './lib/tier.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HINT_CAP = 12;
const COOLDOWN = 5;

// ---- the card (from references/ladder.md, so the text has one home) ---------
const FALLBACK_CARD = 'Take the cheapest rung that clears the bar: answer from context → inline edit → script/CLI with filtered output → skill → Explore(haiku) → orch-* role agent in a worktree → /orchestrate for several with a ledger → fork → dynamic workflow (tell the user the prompt) → /batch → agent team (off). Ask ONE question only for money, public, credentials, destructive or strategic forks. Wait with Monitor/ScheduleWakeup/CronCreate, never a sleep loop.';
function cardBody() {
  try {
    const md = readFileSync(join(SKILL_DIR, 'references', 'ladder.md'), 'utf8');
    const m = /```card\s*\n([\s\S]*?)\n```/.exec(md);
    if (m && m[1].trim()) return m[1].trim();
  } catch {}
  return FALLBACK_CARD;
}
const LADDER_LINE = 'ladder: context → inline → script → skill → Explore(haiku) → orch-* worktree → fork → workflow → /batch; ask only money/public/credential/destructive/strategic; wait with Monitor, not polling';

// ---- features ---------------------------------------------------------------
const VERBS = 'add|fix|build|create|implement|write|refactor|migrate|set up|setup|deploy|release|run|test|review|research|find|check|update|remove|rename|move|convert|install|configure|wire|ship|publish|merge|split|extract|document|port|upgrade|audit|generate|investigate|debug|make|open|tag|decide|verify|measure|compare|plan|do|get|look|port|clone|land';
const CLAUSE_SPLIT = /\s*(?:\band then\b|\band\b|\bthen\b|\bafter that\b|\bafter\b|\bbefore\b|\balso\b|\bplus\b|;|,|\n|^\s*[-*•]\s+|^\s*\d+[.)]\s+)\s*/gim;
const HEAD_RE = new RegExp(`^(?:please\\s+|now\\s+|also\\s+|first\\s+|finally\\s+|next\\s+)?(?:${VERBS})\\b`, 'i');
const RX = {
  // A leading connective hid a whole class of question. "also is there a
  // recommended X for each tier" has no question mark and does not start with a
  // question word, so it read as a statement and the router stayed silent on
  // exactly the follow-up people ask when they are engaged. Strip the
  // connective before testing, and accept "is there" and friends.
  question: /(\?\s*$)|^(?:(?:also|and|but|so|plus|ok|okay|now|hey|oh|btw)[,\s]+)*(what|why|how|when|where|which|who|is|are|was|were|does|do|did|can|could|should|would|will|any|whats|what's|have|has)\b/i,
  // A bare `client.rs` names a file as surely as `src/client.rs` does. Counting
  // only slashed paths read "implement the retry logic in client.rs and
  // websocket.rs" as touching zero files, and so as one small inline change.
  path: /(^|[\s"'`(])(\.{1,2}\/|~\/|[A-Za-z]:[\\/]|\/[\w.-]+\/|[\w.-]+\/[\w./-]+|\*\.\w+|\*\*|[\w-]+\.(?:m?[jt]sx?|py|rs|go|rb|java|kt|c|h|cpp|cs|php|swift|sh|sql|toml|ya?ml|json|md))\b/g,
  scope: /\b(all|every|each|across|entire|whole|repo-wide|per (file|package|crate|module|service))\b/i,
  url: /https?:\/\//g,
  deixis: /\b(as we discussed|you already|this conversation|from what we|earlier you|like you did|the diff we)\b/i,
  // Two different questions, and they were one regex until an audit pointed at
  // the gap. `risky` is "should the user be asked before this happens": money,
  // public surfaces, credentials, destructive or irreversible acts. `review` is
  // "does this class require an independent reviewer", the list in routing.md.
  // Auth, payments and a schema default are review classes and not ask-first
  // ones, so with a single regex an Opus manager was told to review a
  // Sonnet-authored auth change itself.
  risky: /\b(deploy|publish|release|push (to )?(main|master|prod|production)|force[- ]push|delete|drop|rm -rf|wipe|purge|pay|buy|charge|credential|password|token|secret|prod|production|customers?|public)\b/i,
  review: /\b(auth|authn|authz|authentication|authorisation|authorization|login|session|jwt|oauth|password|token|secret|credential|security|crypto|permission|payment|payments|billing|stripe|invoice|charge|refund|schema|migration|migrate|default|irreversible|destructive|delete|drop|truncate|backfill|rewrite|public|customers?|prod|production|deploy|publish|release)\b/i,
  wait: /\b(wait (for|until)|poll(ing)?|every \d+ ?(s|sec|m|min|h|hours?|minutes?)|check back|when (ci|the pr|deploy|the build|the deploy) (finishes|passes|is green|goes green|completes)|remind me|in \d+ (minutes|hours))\b/i,
  keepWorking: /\b(until (the |all )?(tests?|ci|build|it|they|lint) (pass|passes|is green|are green|works?|goes green)|keep going|don'?t stop|loop until|until (it'?s|its) (green|done))\b/i,
  research: /\b(latest|recommended|current(ly)?|cite|sources?|best (way|practice)|state of the art|what'?s new|documentation says)\b/i,
  explore: /\b(how does|how do|where is|where are|trace|what calls|who calls|understand|architecture|walk me through|explain how|map out)\b/i,
  script: /\b(count|list|how many|which files|lines of code|size|duplicates|diff|git log|status|run the (tests?|gate|suite|lint|checks?))\b/i,
  mechanical: /\b(rename|replace|convert|add (a )?header|update (the )?imports?|bump)\b/i,
  planFirst: /\b(design|architect|decide|choose|approach|strategy|rewrite|re-?architect|options|best way|or should)\b/i,
  browser: /\b(browser|web ?page|click|screenshot|form|log ?in|dashboard)\b/i,
  team: /\b(agent teams?|teammates?)\b/i,
  workflowWord: /\b(use|run|start|write|as|with) a (dynamic )?workflow\b|\bdynamic workflow\b|\bultracode\b/i,
  lookup: /\b(how many|count|which files|list (the|all))\b/i,
  batchWord: /\/batch\b/,
  resume: /\b(continue|resume|pick up|where we left off|carry on|left off)\b/i,
  testReview: /\b(tests?|tested|review(ed)?|verify|verification|release|migrate|migration|deploy|end to end|e2e)\b/i,
  parallel: /\b(in parallel|in the background|meanwhile|while you)\b/i,
  perUnit: /\b(per (file|package|service|module|crate)|each (file|package|module|crate)|every (file|package|module|crate)|PR per)\b/i,
  change: /\b(refactor|extract|implement|migrate|add|fix|build|create|write)\b/i,
  // The shape that turns a research question into a dispatch: an answer that
  // covers a set of cases, or becomes a default, gets written down and
  // inherited by everyone after. One search never settles one of those.
  setShape: /\b(for each|per (tier|plan|level|option|case|model|environment)|every (tier|plan|level|option|case|model)|all (three|four|five|\d+)|\d+ (tiers|plans|options|levels|models)|each (tier|plan|level|option|subscription)|defaults?|which .{0,30}should (i|we|you) use)\b/i,
};

export function analyze(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const codeLike = lines.filter(l => /[{}()\[\];=<>]|^\s{2,}\S|^(at |File "|Traceback|\s*\d+ \|)/.test(l)).length;
  const paste = /```/.test(t) || (lines.length >= 8 && codeLike / lines.length > 0.6);
  const clauses = t.split(CLAUSE_SPLIT).map(s => s.trim()).filter(Boolean);
  const heads = clauses.filter(c => HEAD_RE.test(c)).length;
  const count = re => (t.match(re) || []).length;
  const f = {
    words, heads, paste,
    question: RX.question.test(t.trim()) && heads === 0,
    paths: count(RX.path), scope: RX.scope.test(t), urls: count(RX.url), deixis: RX.deixis.test(t),
    risky: RX.risky.test(t), review: RX.review.test(t), wait: RX.wait.test(t), keepWorking: RX.keepWorking.test(t),
    research: RX.research.test(t), explore: RX.explore.test(t), script: RX.script.test(t),
    mechanical: RX.mechanical.test(t), planFirst: RX.planFirst.test(t), browser: RX.browser.test(t),
    team: RX.team.test(t), workflowWord: RX.workflowWord.test(t), batchWord: RX.batchWord.test(t),
    resume: RX.resume.test(t), testReview: RX.testReview.test(t), parallel: RX.parallel.test(t),
    perUnit: RX.perUnit.test(t), change: RX.change.test(t), slash: /^\s*\//.test(t),
    setShape: RX.setShape.test(t),
    lookup: RX.lookup.test(t),
  };
  f.riskyWord = (RX.risky.exec(t) || [''])[0];
  return f;
}

// ---- classification ---------------------------------------------------------
// Returns { rung, confident, orth: [...], evidence }
export function classify(f, ctx) {
  const orth = [];
  if (f.risky) orth.push('ask');
  if (f.planFirst && ctx.permission_mode !== 'plan' && f.heads >= 1) orth.push('plan');
  if (f.keepWorking) orth.push('goal');
  if (f.wait) orth.push('wait');
  if (f.browser) orth.push('browser');

  // "continue" is one word and the short-prompt gate below dropped it before
  // the resume rule could ever see it — the one moment a hint pays for itself,
  // because an open run plus a resume word means read RUN.md and do not re-plan.
  if (f.resume && ctx.openRun && ctx.openRun.open && !f.slash && !f.paste) {
    return { rung: 11, confident: true, orth, evidence: `open run ${ctx.openRun.runId} + resume words` };
  }
  if (f.slash || f.paste || f.words < 4) return { rung: 0, confident: false, orth, evidence: f.slash ? 'command' : f.paste ? 'paste' : 'short' };
  if (f.team) return { rung: 10, confident: true, orth, evidence: 'asks for an agent team' };
  if (f.workflowWord || f.batchWord) return { rung: 0, confident: false, orth, evidence: 'user chose the lane' };
  if (f.heads >= 4 && f.scope && f.perUnit) return { rung: 8, confident: true, orth, evidence: `${f.heads} steps across many units` };
  if (f.scope && f.mechanical && f.perUnit) return { rung: 9, confident: true, orth, evidence: 'one mechanical change per unit' };
  if (f.deixis && f.parallel) return { rung: 7, confident: true, orth, evidence: 'needs this conversation, in parallel' };
  if (f.heads >= 3) return { rung: 6.5, confident: true, orth, evidence: `${f.heads} steps` };
  if (f.heads >= 2 && f.testReview) return { rung: 6.5, confident: true, orth, evidence: `${f.heads} steps + tests/review` };
  if (f.words >= 120 && f.heads >= 2) return { rung: 6.5, confident: false, orth, evidence: 'long, several steps' };
  // A research question whose answer covers a set of cases is not the same as
  // one that covers a case. The answer becomes a default others inherit, no test
  // can prove it wrong, and one search never settles it. That is a dispatch.
  if (f.question && f.research && f.setShape) return { rung: 3.6, confident: true, orth, evidence: 'a recommendation across a set of cases' };
  if (f.question && f.research) return { rung: 3.5, confident: true, orth, evidence: 'research question, current + cite' };
  if (f.script && f.heads <= 1 && !f.testReview && !f.explore) return { rung: 3, confident: f.paths > 0 || f.lookup, orth, evidence: 'mechanical lookup' };
  if (f.question && f.words <= 40 && !f.urls && !f.research) return { rung: 1, confident: true, orth, evidence: 'short question' };
  if (f.explore) return { rung: 5, confident: true, orth, evidence: 'read-only understanding' };
  if (f.heads >= 1 && f.testReview) return { rung: 6, confident: true, orth, evidence: 'a change with tests or verification' };
  if (f.paths >= 2 && f.heads >= 1) return { rung: 6, confident: true, orth, evidence: 'several files' };
  if (f.change && f.heads >= 1 && f.words > 40) return { rung: 6, confident: false, orth, evidence: 'a sizeable change' };
  if (f.scope && f.heads === 0 && !f.question) return { rung: 5, confident: false, orth, evidence: 'wide scope, no edit verb' };
  if (f.heads === 1 && f.words <= 40 && f.paths <= 1 && !f.scope && !f.risky) return { rung: 2, confident: true, orth, evidence: 'one small change' };
  return { rung: 2, confident: false, orth, evidence: 'default' };
}

// ---- models by tier ---------------------------------------------------------
function modelsFor(tier, limits) {
  const t = tier || 'unknown';
  const impl = t === 'max20' ? 'opus' : 'sonnet';
  const rev = 'opus';
  const plan = t === 'max20' ? 'fable' : t === 'max5' ? 'opus or fable' : 'opus';
  const fix = m => m.split(' or ').map(x => applyLimits(x, limits)).join(' or ');
  return { impl: fix(impl), rev: fix(rev), plan: fix(plan) };
}

// Who reviews. A manager strictly above the author already holds the goal and
// the packet, so reading the diff itself is cheaper than a reviewer dispatch
// and no less independent of the author. At or below the author, or on a risky
// change, that stops being true and a reviewer is dispatched on a model no
// weaker than the author's. The manager never reviews its own edits.
export function reviewClause(m, f, ctx) {
  const author = (m.impl || '').split(' or ')[0];
  const self = ctx.self && ctx.self.model;
  if (!f.review && self && strongerThan(self, author)) {
    return `review the diff yourself (${self} over ${author}, not a review class); dispatch orch-reviewer only if you wrote any of it`;
  }
  return `orch-reviewer ${m.rev}${f.review ? ' (required: this class always gets an independent reviewer)' : ''}${self && !strongerThan(self, author) ? `, at or above ${author}` : ''}`;
}

function hintFor(c, f, ctx) {
  const m = modelsFor(ctx.tier, ctx.limits);
  const parts = [];
  switch (c.rung) {
    case 11: parts.push(`→ /orchestrate resume: read RUN.md once, continue from Pickup ("${(ctx.openRun.pickup['Pickup prompt'] || '').slice(0, 80)}"), do not re-plan`); break;
    case 10: parts.push('→ agent teams are experimental, ~7x tokens, off here; use /orchestrate'); break;
    case 9: parts.push('→ /batch (user-typed): one mechanical change, a PR per unit'); break;
    case 8: parts.push('→ dynamic workflow: give the user the one-line prompt "use a workflow to …"; results stay out of context'); break;
    case 7: parts.push('→ fork (needs this conversation; reads the parent cache); documented, unverified here'); break;
    case 6.5: parts.push(`→ /orchestrate; ${ctx.tier}: orch-implementer ${m.impl}, ${reviewClause(m, f, ctx)}`); break;
    case 6: parts.push(`→ orch-implementer ${m.impl} in a worktree, packet per contracts.md${ctx.repoRoot ? '' : ' (no .git above cwd: no worktree isolation)'}; ${reviewClause(m, f, ctx)}`); break;
    case 5: parts.push('→ Explore on haiku, return ≤ 20 lines'); break;
    case 3.6: parts.push(`→ dispatch orch-researcher ${applyLimits('sonnet', ctx.limits)}. A table from one search is never an answer: this one gets written down and inherited, and no test can prove it wrong.`); break;
    case 3.5: parts.push(`→ fetch the primary source inline if one settles it, cite it, and say what it does not settle; orch-researcher ${applyLimits('sonnet', ctx.limits)} if sources may conflict. Not from memory.`); break;
    case 3: parts.push('→ rg | head, git, --json | filter; Explore(haiku) only past ~3 files'); break;
    default: break;
  }
  if (c.orth.includes('goal')) parts.push('→ keep-working: propose "/goal <condition>" (user-typed) or the Stop hook, not repeated prompts');
  if (c.orth.includes('wait')) parts.push('→ wait with Monitor / ScheduleWakeup / CronCreate / /loop, not a sleep loop');
  if (c.orth.includes('ask')) parts.push(`; one question with a recommendation before the "${f.riskyWord}" step`);
  if (c.orth.includes('plan')) parts.push('; plan mode first (approach is open)');
  if (c.orth.includes('browser')) parts.push('; browser tasks one at a time (orch-browser)');
  if (!parts.length) return '';
  return `[orch-router] ${rungLabel(c.rung)}: ${c.evidence} ${parts.join(' ')}`.replace(/\s+;/g, ';');
}

function rungLabel(r) {
  return ({ 1: 'answer', 2: 'inline', 3: 'script', 3.5: 'research', 3.6: 'research across a set', 4: 'skill', 5: 'explore', 6: 'agent', 6.5: 'multi-step', 7: 'fork', 8: 'workflow', 9: 'batch', 10: 'team', 11: 'resume' })[r] || 'note';
}

// ---- the manager's own setup ------------------------------------------------
// The user picks the conversation's model and effort before the manager exists,
// so the manager cannot set them. It can notice they are wrong and say the fix
// once. references/models.md has the reasoning; this is the check.
export const MANAGER_SETUP = {
  pro: { model: 'sonnet', effort: 'high' },
  max5: { model: 'opus', effort: 'high' },
  max20: { model: 'opus', effort: 'high' },
  team: { model: 'sonnet', effort: 'high' },
  api: { model: 'opus', effort: 'high' },
};
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

export function managerAdvice(tier, self) {
  const want = MANAGER_SETUP[tier];
  if (!want || !self || !self.model) return '';
  const parts = [];
  if (self.model !== want.model) parts.push(`${want.model} rather than ${self.model}`);
  const have = EFFORT_ORDER.indexOf(String(self.effort || '').toLowerCase());
  const need = EFFORT_ORDER.indexOf(want.effort);
  if (self.effort && have >= 0) {
    if (have < need) parts.push(`${want.effort} effort rather than ${self.effort}`);
    else if (have > need + 1) parts.push(`${want.effort} effort rather than ${self.effort}, which is the worker profile`);
  }
  if (!parts.length) return '';
  return `[orch-router · your setup] on ${tier}, a manager belongs on ${parts.join(' and ')}. Many short turns, so depth is spent on the dispatched roles instead. Set it now, not mid-run: changing either rebuilds the whole prompt cache. See references/models.md.`;
}

// ---- state line -------------------------------------------------------------
function stateLine(ctx, prefix) {
  const run = ctx.openRun && ctx.openRun.open ? `open run: ${ctx.openRun.runId}` : 'open run: none in this repo';
  const limits = ctx.limits.length ? `limits today: ${ctx.limits.join(', ')}` : 'limits today: none';
  const you = ctx.self ? `you: ${ctx.self.model}${ctx.self.effort ? ` @ ${ctx.self.effort} effort` : ''}` : 'you: unknown model';
  return `${prefix} ${you} · tier ${ctx.tier} · orch-agents ${ctx.agents}/6 · ${run} · ${limits}`;
}

function stateHash(ctx) {
  return [ctx.tier, ctx.agents, ctx.openRun && ctx.openRun.open ? ctx.openRun.runId : '', ctx.limits.join(','), ctx.self ? `${ctx.self.model}/${ctx.self.effort}` : ''].join('|');
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
  const run = latestRun(repoRoot || input.cwd);
  const limits = scanLimits(input.transcript_path, state);
  state.limits = limits;
  const self = selfModel(input.transcript_path);
  if (self) state.self = self;
  return {
    tier: state.tier, agents: agentsInstalled().installed, repoRoot, openRun: run,
    limits, permission_mode: input.permission_mode || '',
    self: self || state.self || null,
  };
}

function newState(input) {
  return { v: 1, session_id: input.session_id || 'unknown', cwd: input.cwd || '', started: new Date().toISOString(), prompts: 0, cardSent: false, muted: false, lastPromptId: null, hints: [], lastStateHash: null, limits: [] };
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

function handlePrompt(input) {
  if (!routerSettings().enabled) return;
  const text = promptText(input);
  if (text == null) return;
  const state = loadSession(input.session_id) || newState(input);
  if (input.prompt_id && state.lastPromptId === input.prompt_id) return;
  if (input.prompt_id) state.lastPromptId = input.prompt_id;
  const trimmed = text.trim();
  if (/^router (off|on)$/i.test(trimmed)) { state.muted = /off$/i.test(trimmed); saveSession(state); return; }
  if (/^\s*\/orchestrate\b/.test(trimmed)) state.orchestrateActive = true;
  if (state.muted) { saveSession(state); return; }

  const f = analyze(text);
  const ctx = gatherContext(input, state);
  if (ctx.openRun && ctx.openRun.open && ctx.openRun.mtimeMs > Date.parse(state.started)) state.orchestrateActive = true;
  const c = classify(f, ctx);
  const substantive = c.rung !== 0;
  const out = [];

  // A hint is worth its tokens only when the classification is confident and
  // says something the default does not: a rung above "inline", or a decisive
  // orthogonal move (wait, keep-working, ask, plan, browser).
  const key = `${c.rung}:${c.orth.join(',')}`;
  const worthy = c.confident && (![1, 2].includes(c.rung) || c.orth.length > 0) && !(c.rung === 6.5 && state.orchestrateActive);

  if (!state.cardSent && substantive) {
    out.push(stateLine(ctx, '[orch-router · once per session]'));
    out.push(cardBody());
    // Once, with the card: the one setting the user has to get right, and only
    // when they have it wrong. Silence when it is already correct.
    const advice = managerAdvice(ctx.tier, ctx.self);
    if (advice) out.push(advice);
    state.cardSent = true;
    state.lastStateHash = stateHash(ctx);
    if (worthy) {
      const h = hintFor(c, f, ctx);
      if (h) { out.push(h); state.hints.push({ at: new Date().toISOString(), key, prompt: state.prompts }); }
    }
  } else if (substantive) {
    const h = state.hints || [];
    const recent = h.some(x => x.key === key && state.prompts - x.prompt < COOLDOWN);
    if (worthy && !recent && h.length < HINT_CAP) {
      const line = hintFor(c, f, ctx);
      if (line) { out.push(line); h.push({ at: new Date().toISOString(), key, prompt: state.prompts }); state.hints = h; }
    }
    const hash = stateHash(ctx);
    if (state.cardSent && state.lastStateHash && hash !== state.lastStateHash) {
      out.push(stateLine(ctx, '[orch-router · state]'));
    }
    if (state.cardSent) state.lastStateHash = hash;
  }
  if (substantive) state.prompts++;
  saveSession(state);
  maybePrune();
  emit('UserPromptSubmit', out.join('\n'));
}

function handleSessionStart(input) {
  if (!routerSettings().enabled) return;
  const source = input.source || 'startup';
  if (source === 'clear') { try { unlinkSync(sessionPath(input.session_id)); } catch {} return; }
  if (source === 'startup') { pruneSessions(7); return; }
  if (source !== 'resume' && source !== 'compact') return;
  const state = loadSession(input.session_id) || newState(input);
  const ctx = gatherContext(input, state);
  const out = [];
  if (ctx.openRun && ctx.openRun.open) {
    const p = ctx.openRun.pickup;
    const pick = p['Pickup prompt'] ? ` — Pickup: "${p['Pickup prompt']}" (confidence ${p['Pickup confidence'] || '?'}, risk ${p['Resume risk'] || '?'})` : ' — Pickup line not written yet';
    out.push(`[orch-router · ${source === 'resume' ? 'resumed' : 'compacted'}] open run ${ctx.openRun.runMd}${pick} · tier ${ctx.tier}${ctx.limits.length ? ` · limits today: ${ctx.limits.join(', ')}` : ''}`);
    state.orchestrateActive = true;
  }
  if (source === 'compact') out.push(LADDER_LINE);
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
function explain(prompt) {
  const f = analyze(prompt);
  const state = { tier: detectTier().tier, limits: [] };
  const ctx = { tier: state.tier, agents: agentsInstalled().installed, repoRoot: findRepoRoot(process.cwd()), openRun: latestRun(findRepoRoot(process.cwd()) || process.cwd()), limits: [], permission_mode: '' };
  const c = classify(f, ctx);
  console.log(JSON.stringify({ features: f, rung: c.rung, label: rungLabel(c.rung), confident: c.confident, orth: c.orth, evidence: c.evidence, hint: hintFor(c, f, ctx) || '(silent)' }, null, 2));
}

// The router's share of a session is one number, and it must not depend on
// which script you ask. This mode used to parse the transcript itself and
// counted any string containing "[orch-router" — including a tool result that
// merely quoted one — so a session that read its own fixtures reported six
// injections where there had been none. measure.mjs owns the parsing now,
// including the rule that a tool result is not an injection.
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
// Guarded, so importing this file for a test does not run the hook. Without the
// guard the `else` branch below reads stdin at import time and hangs forever,
// which is why every test of this file had to spawn it as a child process.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--explain') explain(args.slice(1).join(' '));
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
