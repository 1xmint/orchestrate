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

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function measure(text) {
  const r = {
    session: null, effort: null, models: {}, turns: 0,
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    dispatches: [], routerInjections: 0, routerBytes: 0, routerReread: 0,
    hookContext: 0, returns: [], started: null, ended: null, records: 0, skipped: 0,
  };
  const marks = [];

  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    r.records++;
    let o; try { o = JSON.parse(line); } catch { r.skipped++; continue; }
    if (o.sessionId && !r.session) r.session = o.sessionId;
    if (typeof o.effort === 'string') r.effort = o.effort;
    if (o.timestamp) { if (!r.started) r.started = o.timestamp; r.ended = o.timestamp; }

    const msg = o.message || {};
    if (o.type === 'assistant') {
      for (const m of marks) m.after++;
      const u = msg.usage;
      if (u) {
        r.turns++;
        r.input += num(u.input_tokens);
        r.output += num(u.output_tokens);
        r.cacheRead += num(u.cache_read_input_tokens);
        r.cacheWrite += num(u.cache_creation_input_tokens);
      }
      if (typeof msg.model === 'string') r.models[msg.model] = (r.models[msg.model] || 0) + 1;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b && b.type === 'tool_use' && b.name === 'Agent') {
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

    // Hook output and skill injections arrive as plain user-role text. Tool
    // results are skipped: a session that greps its own fixtures would
    // otherwise count them as injections and inflate every number here.
    if (o.type === 'user') {
      for (const s of strings(withoutToolResults(msg.content))) {
        const at = s.indexOf('[orch-router');
        if (at >= 0) { const bytes = s.length - at; r.routerInjections++; r.routerBytes += bytes; marks.push({ bytes, after: 0 }); }
        if (/orchestrate (guard|ledger):/.test(s)) r.hookContext += s.length;
        const m = /^\s*TASK:\s*(\S+)/m.exec(s);
        if (m && /^\s*(RESTATED|STATUS):/m.test(s)) r.returns.push({ task: m[1], lines: s.trim().split('\n').length });
      }
    }
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
    L.push(`returns: ${r.returns.length}, ${Math.min(...lines)}–${Math.max(...lines)} lines, median ${median(lines)} (the cap is 40)`);
    const over = r.returns.filter(x => x.lines > 40).length;
    if (over) L.push(`  ${over} over the cap: the return check let them through, or the agent files were not installed`);
  } else L.push('returns: none in the schema');
  L.push('');
  L.push(`router: ${r.routerInjections} injections, ${r.routerBytes} bytes (≈ ${Math.round(r.routerBytes / 4)} tokens once)`);
  L.push(`  re-read over later turns: ≈ ${Math.round(r.routerReread / 4)} cache-read tokens, cumulative`);
  L.push(`hook context from the guard and the ledger: ${r.hookContext} bytes (≈ ${Math.round(r.hookContext / 4)} tokens)`);
  const share = r.input + r.cacheRead + r.cacheWrite;
  if (share) L.push(`  the router is ${((r.routerBytes / 4 + r.routerReread / 4) / share * 100).toFixed(2)}% of everything this session read`);
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
  const r = measure(readFileSync(path, 'utf8'));
  console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : report(r));
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
