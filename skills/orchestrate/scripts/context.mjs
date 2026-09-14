#!/usr/bin/env node
// context.mjs — the on-demand context report. Reads a transcript with the same
// reader every hook uses (lib/context.mjs) and says how big the conversation is
// now, how fresh that figure is, what compaction did, and what to do next.
// Read-only: it does not change what the hooks have announced.
//
//   node context.mjs <transcript.jsonl>          readable report
//   node context.mjs --latest [--project <dir>]  newest transcript for a project
//   node context.mjs --session <id>              find a session's transcript
//   node context.mjs ... --agent <agent id>      one helper's own context
//   node context.mjs ... --json                  the same as JSON

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContext, adviseContext, formatReading, agentTranscriptPath, storedContext, findSessionTranscript, CONTEXT_DIR } from './lib/context.mjs';
import { loadPolicy } from './lib/policy.mjs';
import { latestTranscript } from './measure.mjs';

export { findSessionTranscript };

// Helpers whose context a hook has recorded for this session.
export function recordedAgents(sessionId, dir = CONTEXT_DIR) {
  const d = join(dir, String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '_'));
  let names = [];
  try { names = readdirSync(d); } catch { return []; }
  return names.filter(n => /^agent-.+\.json$/.test(n)).map(n => n.slice(6, -5)).map(id => ({ id, reading: storedContext(sessionId, id, dir) })).filter(a => a.reading);
}

export function buildReport({ transcript, agent = null, now = Date.now(), policy = loadPolicy() }) {
  const session = basename(transcript, '.jsonl');
  const path = agent ? agentTranscriptPath(transcript, agent) : transcript;
  const reading = readContext(path, { session, agent, now, policy });
  const { offset, size, ...clean } = reading;
  const advice = adviseContext(clean, policy);
  const agents = agent ? [] : recordedAgents(session).map(a => ({ id: a.id, state: a.reading.state, tokens: a.reading.tokens, model: a.reading.model, readAt: a.reading.readAt }));
  return { v: 1, session, agent, transcript: path, reading: clean, advice, thresholds: policy.context, agents };
}

function main() {
  const args = process.argv.slice(2);
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  let transcript = args.find((a, i) => !a.startsWith('--') && !['--project', '--session', '--agent'].includes(args[i - 1]));
  if (args.includes('--latest')) transcript = latestTranscript(val('--project') || process.cwd());
  if (val('--session')) transcript = findSessionTranscript(val('--session'));
  if (!transcript || !existsSync(transcript) || !statSync(transcript).isFile()) {
    console.error('usage: context.mjs <transcript.jsonl> | --latest [--project <dir>] | --session <id>  [--agent <id>] [--json]');
    process.exit(2);
  }
  const agent = val('--agent');
  if (agent && !agentTranscriptPath(transcript, agent)) { console.error(`no transcript for agent ${agent} next to ${transcript}`); process.exit(2); }
  const r = buildReport({ transcript, agent });
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`# ${r.transcript}`);
  console.log(formatReading(r.reading, r.advice));
  for (const a of r.agents) console.log(`  helper ${a.id}: ${a.tokens == null ? 'unknown' : `${Math.round(a.tokens / 1000)}k`} (${a.state}${a.model ? `, ${a.model}` : ''})`);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
