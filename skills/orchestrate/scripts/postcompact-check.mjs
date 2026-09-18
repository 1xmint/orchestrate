#!/usr/bin/env node
// postcompact-check.mjs — a PostCompact hook: the read-side companion to
// precompact-check.mjs's write-side warning. A helper compacts on its own
// when its window fills (hosts.md, "Helper compaction"), and nothing outside
// it can trigger that compaction or shape its result — but the host still
// hands the compacted summary to a hook that fires inside the helper
// (`agent_id` present, hooks.md PostCompact input, read 2026-09-18). That
// summary is the only thing the helper's continued work now knows about
// everything before it; today it is thrown away the moment the hook exits.
//
// So: when this fires inside a helper (`agent_id` present) whose session is
// bound to a run, save `compact_summary` under that run's returns/ folder as
// `<agent_id>-compact-<n>.md` (n counts up per agent, read from the existing
// returns.jsonl rather than kept in separate state — one less file to lose),
// and append one `{at, kind: "compact", agentId, file}` row to that folder's
// returns.jsonl. ledger.mjs reads those rows back when the helper's return
// lands, and turns them into one fact the lead sees.
//
// Lead-side PostCompact (no `agent_id`) does nothing: the lead is not this
// hook's job, and precompact-check.mjs's unbound-session checkpoint already
// covers that compaction.
//
// It never fails the compaction on its own errors; exit 0 always, same rule
// as precompact-check.mjs.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeId, sessionRun } from './lib/tier.mjs';

export const INDEX_NAME = 'returns.jsonl';

// How many compact rows this agent already has in this run's index, plus one.
// Reading the index rather than keeping a counter file means a lost or
// replayed hook call still lands on the right number: the count is always
// derived from what is actually on disk.
export function nextCompactN(dir, agentId) {
  try {
    const idx = join(dir, INDEX_NAME);
    if (!existsSync(idx)) return 1;
    let n = 0;
    for (const line of readFileSync(idx, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o && o.kind === 'compact' && o.agentId === agentId) n++;
    }
    return n + 1;
  } catch { return 1; }
}

// Pure: given the hook input and the run it resolves to (or null when
// unbound), what to write and where — or null when there is nothing to do.
// `run` is injected rather than resolved here so this stays testable without
// a session store on disk.
export function decide(input, run) {
  if (!input || typeof input !== 'object') return null;
  const agentId = input.agent_id ? String(input.agent_id) : null;
  if (!agentId) return null; // lead-side PostCompact: not this hook's job
  if (!run || !run.dir) return null; // unbound session: nothing to file it under
  const dir = join(run.dir, 'returns');
  const n = nextCompactN(dir, agentId);
  const file = join(dir, `${sanitizeId(agentId)}-compact-${n}.md`);
  const summary = typeof input.compact_summary === 'string' ? input.compact_summary : '';
  return { dir, file, agentId, summary };
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;

  let run = null;
  try { run = sessionRun(input.session_id); } catch { return; }

  let d;
  try { d = decide(input, run); } catch { return; }
  if (!d) return;

  try {
    mkdirSync(d.dir, { recursive: true });
    writeFileSync(d.file, d.summary + (d.summary.endsWith('\n') ? '' : '\n'));
    appendFileSync(join(d.dir, INDEX_NAME), JSON.stringify({ at: new Date().toISOString(), kind: 'compact', agentId: d.agentId, file: d.file }) + '\n');
  } catch {}
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
