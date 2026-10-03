#!/usr/bin/env node
// context-check.mjs — a PostToolUse hook: sample context at tool boundaries.
//
// The router only runs when the user types, and a long autonomous stretch can
// grow the conversation by hundreds of thousands of tokens between prompts. So
// this samples at each tool boundary, reading only the bytes added since the
// last sample (lib/context-store.mjs), and says something only when the advice
// changes: checkpoint, compact at the next safe boundary, or investigate a
// conversation that stayed large after compaction. It also notices a change of
// permission mode (lib/modes.mjs), which is how Plan-mode approval reaches the
// lead mid-turn.
//
// Inside a helper (`agent_id` present) it records that helper's own context
// under its own key and measures it against that role's size budget
// (lib/policy.mjs): once at warnAt and once at returnAt it hears one line of
// facts (size, turn of cap, tool calls since its last edit, its progress
// file), with no instruction attached. The helper decides what to do.
//
// Most calls read one small file, see too little growth, and exit. Never
// blocks, never exits non-zero, never fails the tool call.

import { readFileSync, statSync } from './lib/node.mjs';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { sampleContext, agentTranscriptPath, markAnnounced, storedAdvisedKey } from './lib/context-store.mjs';
import { modeNote, modeOf } from './lib/modes.mjs';
import { cappedNote, helperFiles, nativeAgent, roleMaxTurns, segmentTurns } from './lib/workers.mjs';
import { loadSession, saveSession, routerSettings, findRepoRoot } from './lib/tier.mjs';
import { loadPolicy, sizeBudget } from './lib/policy.mjs';
import { leftoverNote, anyHelperRunning } from './lib/helper-leftovers.mjs';

// ---- which roles can edit ---------------------------------------------------
// "N tool calls since your last edit" is a fact only for a role that has an
// edit tool. A reviewer or advisor cannot edit, so the line told it of a gap
// it could not close. Read from the role's own agent file (assets/agents), the
// same home as its turn cap: a `tools:` list names what it has, a
// `disallowedTools:` list what it lacks from everything else. A shell that is
// not narrowed to named commands counts as able to write; Bash(git diff:*)
// does not. A role with no file is taken to be able to (the fact stays).
const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'agents');
const EDIT_NAMES = ['Edit', 'Write', 'NotebookEdit'];
export function roleCanEdit(role, dir = AGENTS_DIR) {
  let fm;
  try {
    const name = String(role || '').replace(/^[\w-]+:(?=orch-)/, '');
    fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, `${name}.md`), 'utf8').replace(/\r\n/g, '\n'));
  } catch { return true; }
  if (!fm) return true;
  const list = key => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm[1]);
    // split on commas outside parentheses: Bash(git:*) stays one entry
    return m ? m[1].split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean) : null;
  };
  const tools = list('tools');
  const denied = new Set(list('disallowedTools') || []);
  const has = n => (tools ? tools.includes(n) : true) && !denied.has(n);
  return EDIT_NAMES.some(has) || (has('Bash') && (!tools || tools.includes('Bash')));
}

// ---- the working project ----------------------------------------------------
// Which repo and folder this session is actually touching, learned from the
// only signal a hook that runs after every tool call has cheaply: the path a
// call carries. The folder matters because a project is not always a repo
// root — Cortex is the `cortex` folder inside the heyvera repo. Paths outside
// the launch folder (plan files, the plugin cache) are ignored; a path under
// the root already learned is a string-prefix check, no disk read.
const WORK_PATH_KEYS = ['file_path', 'path', 'notebook_path'];

export function pathFromToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  for (const k of WORK_PATH_KEYS) if (typeof toolInput[k] === 'string' && toolInput[k]) return toolInput[k];
  return null;
}

const normSlashes = p => String(p || '').replace(/\\/g, '/');
const underRoot = (path, root) => root && normSlashes(path).toLowerCase().startsWith(`${normSlashes(root).toLowerCase()}/`);

// The folder a path counts toward: the root itself, unless the path sits one
// level or more inside it, in which case its immediate child of the root is
// the folder — the level a project's own instruction file lives at.
function folderOf(path, root) {
  const dir = normSlashes(dirname(resolvePath(path)));
  const r = normSlashes(root);
  if (dir.toLowerCase() === r.toLowerCase()) return root;
  if (!underRoot(dir, root) && dir.toLowerCase() !== r.toLowerCase()) return root;
  const rest = dir.slice(r.length).replace(/^\/+/, '');
  const first = rest.split('/')[0];
  return first ? join(root, first) : root;
}

// Steps `work` ({ counts, root, dir } or null/undefined) by one tool call's
// path, or returns it unchanged when the path is not under the launch folder.
// `root` and `dir` are always the most-touched pair so far; ties keep the
// existing leader, so a single stray read elsewhere does not flip them.
export function stepWork(work, launchRoot, path) {
  if (!launchRoot || !path) return work || null;
  const abs = resolvePath(path);
  if (!underRoot(abs, launchRoot) && normSlashes(abs).toLowerCase() !== normSlashes(launchRoot).toLowerCase()) return work || null;
  const root = (work && work.root && (underRoot(abs, work.root) || normSlashes(abs).toLowerCase() === normSlashes(work.root).toLowerCase()))
    ? work.root
    : (findRepoRoot(dirname(abs)) || launchRoot);
  const folder = folderOf(abs, root);
  const counts = { ...(work && work.counts) };
  const key = `${root}\u0000${folder}`;
  counts[key] = (counts[key] || 0) + 1;
  let bestKey = (work && work.root) ? `${work.root}\u0000${work.dir}` : key;
  let bestN = counts[bestKey] || 0;
  for (const [k, n] of Object.entries(counts)) if (n > bestN) { bestN = n; bestKey = k; }
  const i = bestKey.indexOf('\u0000');
  return { counts, root: bestKey.slice(0, i), dir: bestKey.slice(i + 1) };
}

// The progress-file fact, in the order a reader needs it: no path at all,
// a path that has not been written yet, or a path with how long ago it was
// last written. Never reads the filesystem itself — `minutesAgo` is resolved
// by the caller, since only it knows what "now" and "the file's mtime" mean
// for this run.
// Work calls: the tools a lead uses to actually do things, between dispatches.
// Distinct from lib/context-scan.mjs's EDIT_TOOLS, which counts only file edits for
// the "tool calls since your last edit" line — this counts reading and
// searching too, because a long solo stretch of Read/Grep/Glob is the same
// failure as a long stretch of Edit/Bash.
export const WORK_CALL_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Read', 'Grep', 'Glob']);

// The real settings.json, for the one figure that has to reflect what the
// host actually does (lib/context-advice.mjs's resolveAutocompactWindow):
// read only here, by the running hook, never by a pure function or a test.
const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// One PostToolUse's effect on the "work calls since your last dispatch" count:
// a dispatch (Agent/Task, or a Bash/PowerShell running codex-worker) resets it
// to 0; a work-call tool adds one; anything else leaves it where it was. Pure,
// so a sequence of tool calls can be replayed without touching a session file.
export function stepWorkCalls(count, toolName, toolInput) {
  const c = Number.isFinite(count) ? count : 0;
  if (toolName === 'Agent' || toolName === 'Task') return 0;
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const cmd = toolInput && typeof toolInput.command === 'string' ? toolInput.command : '';
    if (cmd.includes('codex-worker')) return 0;
  }
  return WORK_CALL_TOOLS.has(toolName) ? c + 1 : c;
}

// The fact to add when the count just crossed a multiple of `every` (100,
// 200, 300, …): said once per crossing, never on the way down, since a reset
// only ever drops the count to 0. Null when there is nothing to say.
export function workCallsFact(count, every) {
  if (!every || !Number.isFinite(count) || count <= 0 || count % every !== 0) return null;
  return `${count} work calls since your last dispatch`;
}

// Failed reviews since the last PASS, newest last. A return with no readable
// verdict neither counts nor breaks the run: a reply the parser missed is not
// a pass.
export function failStreak(returned) {
  const of = [];
  let key = null;
  const list = Array.isArray(returned) ? returned : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i] && list[i].verdict;
    if (v === 'PASS') break;
    if (v !== 'FAIL') continue;
    if (key == null) key = String(list[i].agentId || list[i].toolUseId || list[i].at || i);
    of.unshift(String(list[i].reviewOf || '?').slice(0, 8));
  }
  return { count: of.length, of, key };
}

function progressFact(progress) {
  if (!progress || !progress.path) return 'progress file: none given';
  if (progress.minutesAgo == null) return `progress file: ${progress.path}, not written yet`;
  const m = Math.max(0, Math.round(progress.minutesAgo));
  return `progress file: ${progress.path}, written ${m < 1 ? 'just now' : `${m} min ago`}`;
}

// A helper's own size budget, measured against its role: one line of facts,
// no orders — the helper decides what to do with them. Pure: `tokens` is null
// unless the size is measured or provisional (contextTick's own test of
// `reading.state`), `budget` is that role's {warnAt, returnAt}, `announced` is
// the last key this helper already heard (`null` after neither), `turn` and
// `maxTurns` are dropped from the line together when either is unknown, and
// `progress` is `{ path, minutesAgo }` or null. Returns `{ key, text }` or
// null when there is nothing to say. `size-return` outranks `size-warn`: a
// helper that jumps straight past returnAt hears only the return notice, and
// each key is said once. At returnAt the line says "past the budget" in
// words, since "~121k of ~120k" read live as still inside it.
export function helperSizeNotice({ role, tokens, budget, announced = null, turn = null, maxTurns = null, callsSinceEdit = null, progress = null } = {}) {
  if (!budget || tokens == null || !Number.isFinite(tokens)) return null;
  const n = Math.round(tokens / 1000);
  let key = null;
  if (tokens >= budget.returnAt) { key = 'size-return'; }
  else if (tokens >= budget.warnAt) { key = 'size-warn'; }
  if (!key || key === announced) return null;
  const cap = Math.round(budget.returnAt / 1000);
  const parts = [key === 'size-return' ? `~${n}k, past the ~${cap}k budget` : `~${n}k of ~${cap}k budget`];
  if (Number.isFinite(turn) && Number.isFinite(maxTurns)) parts.push(`turn ${turn} of ${maxTurns}`);
  if (Number.isFinite(callsSinceEdit)) parts.push(`${callsSinceEdit} tool call${callsSinceEdit === 1 ? '' : 's'} since your last edit`);
  parts.push(progressFact(progress));
  return { key, text: `[orchestrate · size] ${parts.join(' · ')}` };
}

// Records the working project onto whichever state object the caller already
// has open, by the lead or a helper alike — a helper's edits are as much a
// sign of where the work is as the lead's own. Saves only when it changed.
function trackWork(state, input) {
  const path = pathFromToolInput(input.tool_input);
  if (!path) return false;
  const launchRoot = findRepoRoot(input.cwd);
  if (!launchRoot) return false;
  const next = stepWork(state.work, launchRoot, path);
  if (!next || next === state.work) return false;
  state.work = next;
  return true;
}

// `tool_response` on a PostToolUse(Agent/Task) event, however the host sent
// it: already an object, a JSON string, or absent. Never throws.
function parseToolResponse(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : null; } catch { return null; }
  }
  return null;
}

// The one signal that frees a helper's slot the moment it actually returns,
// instead of waiting on a SubagentStop that never carries the dispatch's own
// id. The Agent/Task tool's own PostToolUse event carries `tool_use_id`,
// which matches the `toolUseId` guard-agent.mjs stored on the dispatch row,
// and its `tool_response` carries `agentId` and a `status` of "completed"
// (a foreground helper already back) or "async_launched" (a background one,
// still running). Marks the row in place; saves only when it changed.
function markDispatchReturn(state, input) {
  if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') return false;
  const toolUseId = input.tool_use_id ? String(input.tool_use_id) : null;
  if (!toolUseId) return false;
  const dispatches = Array.isArray(state.dispatches) ? state.dispatches : [];
  const row = dispatches.find(d => d && d.toolUseId === toolUseId);
  if (!row) return false;
  const tr = parseToolResponse(input.tool_response);
  if (!tr) return false;
  let changed = false;
  if (tr.agentId != null && row.agentId !== String(tr.agentId)) { row.agentId = String(tr.agentId); changed = true; }
  if (tr.status === 'completed' && !row.returnedAt) { row.returnedAt = new Date().toISOString(); changed = true; }
  return changed;
}

export function check(input) {
  if (!input || typeof input !== 'object' || !input.session_id) return '';
  const session = input.session_id;
  const agent = input.agent_id ? String(input.agent_id) : null;
  if (agent) {
    { const s = loadSession(session); if (s && trackWork(s, input)) { try { saveSession(s); } catch {} } }
    const t = input.agent_transcript_path || agentTranscriptPath(input.transcript_path, agent);
    if (t) {
      const sample = sampleContext({ transcriptPath: t, session, agent, announce: false, settingsPath: SETTINGS_PATH, env: process.env });
      const state = loadSession(session) || {};
      const owner = nativeAgent(Array.isArray(state.dispatches) ? state.dispatches : [], helperFiles(input.transcript_path), agent);
      const role = owner ? owner.role : 'default';
      const reading = sample.reading;
      const tokens = reading && (reading.state === 'measured' || reading.state === 'provisional') ? reading.tokens : null;
      const budget = sizeBudget(role, loadPolicy(), sample.baseline);
      const announced = storedAdvisedKey(session, agent);
      // The turn count reads the whole transcript, so it is paid only on the
      // call that is past warnAt, not on every tool call a helper makes.
      if (!budget || tokens == null || tokens < budget.warnAt) return '';
      const maxTurns = roleMaxTurns(owner ? owner.dispatch.agent : role);
      const turn = segmentTurns(t).segment;
      const progressPath = owner && owner.dispatch ? owner.dispatch.progress : null;
      let progress = null;
      if (progressPath) {
        progress = { path: progressPath, minutesAgo: null };
        try { progress.minutesAgo = (Date.now() - statSync(progressPath).mtimeMs) / 60000; } catch {}
      }
      const notice = helperSizeNotice({ role, tokens, budget, announced, turn, maxTurns, callsSinceEdit: roleCanEdit(owner ? owner.dispatch.agent : role) ? sample.editCounter : null, progress });
      if (notice) markAnnounced(session, agent, notice.key);
      return notice ? notice.text : '';
    }
    return '';
  }
  if (!routerSettings().enabled) return '';
  const out = [];
  const state = loadSession(session);
  const prevWorkCalls = state && state.workCalls && Number.isFinite(state.workCalls.count) ? state.workCalls.count : 0;
  const workCalls = stepWorkCalls(prevWorkCalls, input.tool_name, input.tool_input);
  const workCallsChanged = workCalls !== prevWorkCalls;
  let contextLine = '';
  if (input.transcript_path) {
    const bound = (state && state.run && state.run.runMd) || null;
    const r = sampleContext({ transcriptPath: input.transcript_path, session, runMd: bound, permissionMode: modeOf(input), settingsPath: SETTINGS_PATH, env: process.env });
    contextLine = r.notice;
  }
  const fact = workCallsFact(workCalls, loadPolicy().lead.workCallsEvery);
  if (fact) contextLine = contextLine ? `${contextLine} · ${fact}` : `[orchestrate · context] ${fact}`;
  if (contextLine) out.push(contextLine);
  if (state) {
    const before = state.mode || null;
    const note = modeNote(state, input);
    if (note) out.push(note);
    const capped = cappedNote(state);
    if (capped) out.push(capped);
    // A helper's hand-back over the size the ledger keeps whole: said once per
    // helper, here, while the next brief is still to be written.
    const told = Array.isArray(state.longTold) ? state.longTold : [];
    let longTold = false;
    for (const r of Array.isArray(state.returned) ? state.returned : []) {
      const id = r && r.longBytes ? String(r.agentId || r.toolUseId || r.at || '') : '';
      if (!id || told.includes(id)) continue;
      out.push(`[orchestrate · context] last hand-back ${r.longBytes} bytes against 600; it is re-read every later turn.`);
      state.longTold = [...told, id].slice(-50);
      longTold = true;
      break;
    }
    // Reviews that keep failing: said once per new failure from the second in a
    // row, as a fact, while the next fix is still to be chosen. A run once went
    // seven rounds, each a new case of the same kind the decisions ruled out.
    const streak = failStreak(state.returned);
    let streakTold = false;
    if (streak.count >= 2 && state.failStreakTold !== streak.key) {
      out.push(`[orchestrate · context] ${streak.count} reviews in a row returned FAIL (of ${streak.of.join(', ')}), none PASS since.`);
      state.failStreakTold = streak.key;
      streakTold = true;
    }
    if (workCallsChanged) state.workCalls = { count: workCalls };
    const workChanged = trackWork(state, input);
    const returnChanged = markDispatchReturn(state, input);
    // Helper folders and branches left behind: once every helper of the session
    // has returned and something is left, said once, as a fact, while the lead
    // can still act on it. Nothing is removed.
    let leftoverTold = false;
    // The git look is taken once per number of returns, not on every tool call.
    const nReturned = Array.isArray(state.returned) ? state.returned.length : 0;
    if (!state.leftoverTold && nReturned && state.leftoverSeen !== nReturned && !anyHelperRunning({ dispatches: state.dispatches, returned: state.returned })) {
      state.leftoverSeen = nReturned;
      leftoverTold = true;
      const left = leftoverNote({ cwd: state.cwd || input.cwd, returned: state.returned, dispatches: state.dispatches });
      if (left) {
        out.push(`[orchestrate · context] ${left.text}; nothing has removed them.`);
        state.leftoverTold = true;
      }
    }
    if (leftoverTold || streakTold || (state.mode || null) !== before || capped || longTold || workCallsChanged || workChanged || returnChanged) { try { saveSession(state); } catch {} }
  } else if (workCallsChanged) {
    try { saveSession({ v: 1, session_id: session, started: new Date().toISOString(), workCalls: { count: workCalls } }); } catch {}
  }
  return out.join('\n');
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  const text = check(input);
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
