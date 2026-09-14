#!/usr/bin/env node
// measure.mjs — turn a finished session into numbers, at no quota cost.
//
// The claim this skill makes about context and quota efficiency is a reasoned
// estimate until a real run is metered. This reads the transcript Claude Code
// already wrote and answers: what the turns cost, how many dispatches there
// were and to which models, how long the returns were, and what the skill's
// own hooks injected.
//
//   node measure.mjs <transcript.jsonl>            a report
//   node measure.mjs <transcript.jsonl> --json     the same as JSON
//   node measure.mjs --latest [--project <dir>]    the newest transcript for a project
//   node measure.mjs <t> --dollars               the same, priced at list price
//   node measure.mjs <t> --tree [--json]         the lead, every helper and nested
//                                                helper, and Codex worker runs
//
// Transcripts live under ~/.claude/projects/<slugged cwd>/<session id>.jsonl.
// Fields read: message.usage.{input_tokens, cache_creation_input_tokens,
// cache_read_input_tokens, output_tokens} on assistant records, message.model,
// tool_use blocks named Agent, and the top-level timestamp, sessionId and
// effort. Anything missing counts as zero; a corrupt line is skipped.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dollars, family } from './lib/prices.mjs';
import { detectTier, readJson, PROFILE_PATH } from './lib/tier.mjs';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function measure(text) {
  const r = {
    session: null, effort: null, models: {}, turns: 0,
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    dispatches: [], routerInjections: 0, routerBytes: 0, routerReread: 0,
    hookContext: 0, returns: [], started: null, ended: null, records: 0, skipped: 0,
    stopBlocks: 0,
  };
  const marks = [];
  // One API call is written as several records sharing `message.id`, each with
  // a copy of the usage. Count each call once, from its last record; counting
  // records made this session's re-reads look 2.8× what they were.
  const calls = new Map();
  let anon = 0;

  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    r.records++;
    let o; try { o = JSON.parse(line); } catch { r.skipped++; continue; }
    if (o.sessionId && !r.session) r.session = o.sessionId;
    if (o.timestamp) { if (!r.started) r.started = o.timestamp; r.ended = o.timestamp; }

    const msg = o.message || {};
    if (o.type === 'assistant') {
      const synthetic = msg.model === '<synthetic>';
      if (typeof o.effort === 'string' && !synthetic) r.effort = o.effort;
      const id = msg.id || `anon-${anon++}`;
      const fresh = !calls.has(id);
      if (fresh) for (const m of marks) m.after++;
      if (msg.usage) calls.set(id, msg.usage);
      if (fresh && typeof msg.model === 'string' && !synthetic) r.models[msg.model] = (r.models[msg.model] || 0) + 1;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b && b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) {
          const i = b.input || {};
          r.dispatches.push({
            agent: String(i.subagent_type || 'claude'),
            model: String(i.model || 'inherit'),
            background: i.run_in_background !== false,
            packetLines: String(i.prompt || '').split('\n').length,
          });
        }
      }
    }

    // Hook output arrives in two shapes, and for a while this only read one of
    // them. Injected context is an `attachment` record carrying `hookEvent` and
    // a content array; everything else the host feeds back is plain user-role
    // text. Reading only the second reported "0 router injections" on a
    // transcript that plainly held four. Tool results stay skipped: a session
    // that greps its own fixtures would otherwise count them as injections.
    if (o.type === 'user' || o.type === 'attachment') {
      // A background helper's return arrives as a queued task notification
      // whose text is in `prompt`, not `content`.
      const a = o.attachment || {};
      const source = o.type === 'attachment' ? (a.type === 'queued_command' ? a.prompt : a.content) : withoutToolResults(msg.content);
      for (const s of strings(source)) {
        const hit = /\[orch(?:-router|estrate)/.exec(s);
        const at = hit ? hit.index : -1;
        if (at >= 0) { const bytes = s.length - at; r.routerInjections++; r.routerBytes += bytes; marks.push({ bytes, after: 0 }); }
        if (/orchestrate (guard|ledger):/.test(s)) r.hookContext += s.length;
        // A turn sent back by the one remaining Stop hook, counted by the fixed
        // prefix it writes and only when the record *starts* with it. Matching
        // the prefix anywhere counted this repo's own documents, which quote the
        // reason verbatim, as blocks that never happened. Retired checks are not
        // counted at all: a field that can now only ever read zero looks like a
        // measurement and is not one.
        const head = s.trimStart();
        if (head.startsWith('orchestrate: Pickup has')) r.stopBlocks++;
        const m = /^\s*TASK:\s*(\S+)/m.exec(s);
        // STATUS is the current schema; RESTATED is what returns written to the
        // older instruction carry. Both count, because the transcripts this
        // reads are on disk already and predate the change.
        if (m && /^\s*(RESTATED|STATUS):/m.test(s)) r.returns.push({ task: m[1], lines: s.trim().split('\n').length });
      }
    }
  }
  for (const u of calls.values()) {
    r.turns++;
    r.input += num(u.input_tokens);
    r.output += num(u.output_tokens);
    r.cacheRead += num(u.cache_read_input_tokens);
    r.cacheWrite += num(u.cache_creation_input_tokens);
  }
  for (const m of marks) r.routerReread += m.bytes * m.after;
  return r;
}

export function withoutToolResults(content) {
  if (!Array.isArray(content)) return content;
  return content.filter(b => !(b && typeof b === 'object' && b.type === 'tool_result'));
}

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
}

// ---- the whole agent tree ------------------------------------------------------
// A session's cost is the lead plus every helper, and helpers of helpers. Each
// helper writes its own transcript under <session>/subagents/agent-<id>.jsonl,
// with a .meta.json naming its type, the tool call that started it, its spawn
// depth and its parent. One model call is counted once across the whole tree,
// by message id, so streaming copies and a resumed helper's repeated records
// never count twice. Context is per request (the input side of each call);
// totals are consumption, and the two are never mixed.

const inputOf = u => num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);

export function callsOf(text, { lead = false, seen = new Set() } = {}) {
  const r = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, maxContext: 0, lastContext: null, models: [], retries: 0, nestedDispatches: 0, compactions: 0 };
  const byId = new Map();
  const models = new Set();
  const toolUses = new Set();
  let anon = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'system' && o.subtype === 'compact_boundary') { r.compactions++; continue; }
    if (o.type !== 'assistant') continue;
    if (lead && o.isSidechain === true) continue;
    const msg = o.message || {};
    if (o.isApiErrorMessage || (msg.model === '<synthetic>' && /API Error|retry/i.test(JSON.stringify(msg.content || '')))) { r.retries++; continue; }
    if (msg.model === '<synthetic>') continue;
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (!b || b.type !== 'tool_use' || (b.name !== 'Agent' && b.name !== 'Task')) continue;
      if (b.id && toolUses.has(b.id)) continue;
      if (b.id) toolUses.add(b.id);
      r.nestedDispatches++;
    }
    if (!msg.usage) continue;
    const id = msg.id || `anon-${anon++}-${Math.random()}`;
    if (seen.has(id) && !byId.has(id)) continue;
    seen.add(id);
    byId.set(id, msg.usage);
    if (typeof msg.model === 'string') models.add(msg.model);
  }
  for (const u of byId.values()) {
    r.calls++;
    r.input += num(u.input_tokens);
    r.cacheRead += num(u.cache_read_input_tokens);
    r.cacheWrite += num(u.cache_creation_input_tokens);
    r.output += num(u.output_tokens);
    const c = inputOf(u);
    r.maxContext = Math.max(r.maxContext, c);
    r.lastContext = c;
  }
  r.models = [...models];
  return r;
}

export const WORKER_REPORTS_PATH = join(homedir(), '.claude', 'orchestrate', 'workers', 'reports.jsonl');

// Codex worker reports for a session, one per task and checkpoint (a rerun
// that rewrote the same report counts once, as its latest state).
export function workerReports(session, path = WORKER_REPORTS_PATH) {
  const latest = new Map();
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || (session && o.session !== session)) continue;
    latest.set(`${o.taskId}|${o.checkpoint}`, o);
  }
  return [...latest.values()];
}

export function measureTree(leadTranscript, { reportsPath = WORKER_REPORTS_PATH } = {}) {
  const seen = new Set();
  const session = leadTranscript.replace(/\\/g, '/').split('/').pop().replace(/\.jsonl$/, '');
  const lead = { agentId: null, type: 'lead', depth: 0, parent: null, ...callsOf(readFileSync(leadTranscript, 'utf8'), { lead: true, seen }) };
  const dir = join(leadTranscript.replace(/\.jsonl$/, ''), 'subagents');
  const agents = [];
  for (const f of safeList(dir).filter(n => /^agent-.+\.jsonl$/.test(n)).sort()) {
    const agentId = f.slice(6, -6);
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(dir, `agent-${agentId}.meta.json`), 'utf8')) || {}; } catch {}
    let text = '';
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    agents.push({
      agentId, type: meta.agentType || 'unknown', depth: Number(meta.spawnDepth) || 1, parent: meta.parentAgentId || null,
      requestedModel: meta.model || null, toolUseId: meta.toolUseId || null,
      ...callsOf(text, { seen }),
    });
  }
  const codex = workerReports(session, reportsPath);
  const all = [lead, ...agents];
  const sum = k => all.reduce((s, a) => s + (a[k] || 0), 0);
  return {
    session, lead, agents, codex,
    totals: {
      agents: agents.length,
      nestedAgents: agents.filter(a => a.depth > 1).length,
      calls: sum('calls'), input: sum('input'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), output: sum('output'),
      retries: sum('retries'), nestedDispatches: agents.reduce((s, a) => s + a.nestedDispatches, 0),
      maxHelperContext: agents.reduce((m, a) => Math.max(m, a.maxContext), 0),
      codexRuns: codex.length,
      fallbacks: codex.filter(c => c.fallback).length,
    },
  };
}

export function treeReport(t) {
  const L = [];
  const k = n => `${Math.round((n || 0) / 1000)}k`;
  const row = a => `${a.type}${a.agentId ? ` ${a.agentId.slice(0, 8)}` : ''}${a.depth > 1 ? ` (depth ${a.depth}, from ${String(a.parent).slice(0, 8)})` : ''}: ${a.calls} calls on ${a.models.join(', ') || 'no model'}${a.requestedModel ? ` (asked ${a.requestedModel})` : ''} · context up to ${k(a.maxContext)}${a.lastContext != null ? `, last ${k(a.lastContext)}` : ''} · ${k(a.output)} out${a.retries ? ` · ${a.retries} retries` : ''}${a.nestedDispatches ? ` · started ${a.nestedDispatches} helper(s)` : ''}`;
  L.push(`agent tree for ${t.session}`);
  L.push(`  ${row(t.lead)}${t.lead.compactions ? ` · ${t.lead.compactions} compaction(s)` : ''}`);
  // Each helper under the one that started it.
  const ids = new Set(t.agents.map(a => a.agentId));
  const walk = (parent, depth) => {
    for (const a of t.agents.filter(x => (x.parent && ids.has(x.parent) ? x.parent : null) === parent)) {
      L.push(`  ${'  '.repeat(depth)}${row(a)}`);
      walk(a.agentId, depth + 1);
    }
  };
  walk(null, 0);
  for (const c of t.codex) L.push(`  codex ${c.taskId}: ${c.status}${c.usage ? ` · ${k(c.usage.input)} in / ${k(c.usage.output)} out` : ''}${c.fallback ? ' · handed to Claude' : ''}`);
  const x = t.totals;
  L.push(`total: ${x.calls} Claude calls across the lead and ${x.agents} helper(s)${x.nestedAgents ? ` (${x.nestedAgents} started by other helpers)` : ''} · ${k(x.input + x.cacheRead + x.cacheWrite)} input read · ${k(x.output)} out${x.retries ? ` · ${x.retries} retries` : ''}${x.codexRuns ? ` · ${x.codexRuns} Codex run(s), ${x.fallbacks} fallback(s)` : ''}`);
  L.push('consumption totals are summed over calls; context is per request and is never summed');
  return L.join('\n');
}

const tok = n => `${Math.round(n / 1000)}k`;

export function report(r) {
  const L = [];
  const mins = r.started && r.ended ? Math.round((Date.parse(r.ended) - Date.parse(r.started)) / 60000) : null;
  L.push(`session ${r.session || 'unknown'}${r.effort ? ` · effort ${r.effort}` : ''}${mins != null ? ` · ${mins} min` : ''} · ${r.records} records${r.skipped ? ` (${r.skipped} unreadable)` : ''}`);
  L.push(`models: ${Object.entries(r.models).map(([m, n]) => `${m} ×${n}`).join(', ') || 'none recorded'}`);
  L.push('');
  L.push('tokens        fresh input   cache read   cache write   output');
  L.push(`  ${String(r.turns).padStart(4)} turns   ${tok(r.input).padStart(11)}   ${tok(r.cacheRead).padStart(10)}   ${tok(r.cacheWrite).padStart(11)}   ${tok(r.output).padStart(6)}`);
  L.push('');
  if (r.dispatches.length) {
    const by = {};
    for (const d of r.dispatches) { const k = `${d.agent} on ${d.model}`; by[k] = (by[k] || 0) + 1; }
    const packets = r.dispatches.map(d => d.packetLines);
    L.push(`dispatches: ${r.dispatches.length} — ${Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
    L.push(`packets: ${Math.min(...packets)}–${Math.max(...packets)} lines, median ${median(packets)}`);
  } else L.push('dispatches: none');
  if (r.returns.length) {
    const lines = r.returns.map(x => x.lines);
    // Length, with no cap and no verdict attached to it. A long return is a
    // fact about the work, not a defect, and nothing sends one back for it.
    L.push(`returns: ${r.returns.length}, ${Math.min(...lines)}–${Math.max(...lines)} lines, median ${median(lines)}`);
  } else L.push('returns: none in the schema');
  L.push('');
  L.push(`router: ${r.routerInjections} injections, ${r.routerBytes} bytes (≈ ${Math.round(r.routerBytes / 4)} tokens once)`);
  L.push(`  re-read over later turns: ≈ ${Math.round(r.routerReread / 4)} cache-read tokens, cumulative`);
  L.push(`hook context from the guard and the ledger: ${r.hookContext} bytes (≈ ${Math.round(r.hookContext / 4)} tokens)`);
  L.push(`turns sent back by the Pickup check: ${r.stopBlocks} in ${r.turns} turns`);
  const share = r.input + r.cacheRead + r.cacheWrite;
  if (share) L.push(`  the router is ${((r.routerBytes / 4 + r.routerReread / 4) / share * 100).toFixed(2)}% of everything this session read`);
  return L.join('\n');
}

// What the session cost at list price. List price is the host's own unit: the
// Session block of `/usage` computes its dollar figure the same way, locally
// from token counts. It is not what a subscription is billed, and nothing here
// turns it into a share of a plan's week: that needs a weekly dollar figure
// nobody has measured, and the one that used to be here rested on a single
// observation.
export function dollarReport(r, tier, profile) {
  const L = [];
  const fam = Object.keys(r.models).map(family);
  const named = fam.filter(Boolean);
  const main = named.length ? named.sort((a, b) => named.filter(x => x === b).length - named.filter(x => x === a).length)[0] : null;
  const total = main ? dollars({ input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite }, main) : null;
  L.push('');
  // A session whose transcript never names a model is not priced as the cheap
  // one. Unknown stays unknown until something resolves it.
  if (total == null) L.push('this session: not priced — the transcript names no model, and guessing one would invent the figure');
  else L.push(`this session, at list price: $${total.toFixed(2)} on ${main}`);
  if (r.dispatches.length) {
    const by = {};
    for (const d of r.dispatches) { const k = `${d.agent} on ${d.model}`; by[k] = (by[k] || 0) + 1; }
    L.push(`dispatches by model: ${Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
    L.push('  what each one cost is in ~/.claude/orchestrate/costs.jsonl, written by the ledger');
  }
  L.push('list price is the unit /usage shows for a session; a plan is not billed this way');
  return L.join('\n');
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

export function latestTranscript(projectDir) {
  const base = join(homedir(), '.claude', 'projects');
  const slug = String(projectDir || process.cwd()).replace(/[\\/:]/g, '-');
  const dirs = existsSync(join(base, slug)) ? [join(base, slug)] : dirsIn(base);
  let best = null;
  for (const d of dirs) {
    for (const f of safeList(d)) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(d, f);
      try { const st = statSync(p); if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs }; } catch {}
    }
  }
  return best && best.path;
}

const safeList = d => { try { return readdirSync(d); } catch { return []; } };
const dirsIn = base => safeList(base).map(n => join(base, n)).filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } });

function main() {
  const args = process.argv.slice(2);
  let path = args.find(a => !a.startsWith('--'));
  if (args.includes('--latest')) {
    const i = args.indexOf('--project');
    path = latestTranscript(i >= 0 ? args[i + 1] : process.cwd());
    if (!path) { console.error('no transcript found under ~/.claude/projects'); process.exit(1); }
    console.error(`# ${path}`);
  }
  if (!path) { console.error('usage: measure.mjs <transcript.jsonl> | --latest [--project <dir>]'); process.exit(2); }
  if (args.includes('--tree')) {
    const t = measureTree(path);
    console.log(args.includes('--json') ? JSON.stringify(t, null, 2) : treeReport(t));
    return;
  }
  const r = measure(readFileSync(path, 'utf8'));
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(report(r));
  if (args.includes('--dollars')) console.log(dollarReport(r, detectTier().tier, readJson(PROFILE_PATH)));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
