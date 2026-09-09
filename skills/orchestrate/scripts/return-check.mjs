#!/usr/bin/env node
// return-check.mjs — each role agent's own Stop hook (Claude Code delivers it
// as SubagentStop). It refuses to let a subagent finish while its return is
// not in the packet's schema, so the orchestrator never has to spend a turn
// asking for the fields again.
//
// Blocks when RESTATED, STATUS or EVIDENCE is missing, or the return runs past
// 60 lines. At most twice per agent invocation: a third block would be an agent
// that cannot produce the shape, and stalling costs more than grading it
// Failed. Claude Code caps stop-hook blocks anyway.
//
// Registered from the agent file, not from settings.json:
//   hooks:
//     Stop:
//       - type: command
//         command: node "{{SKILL_DIR}}/scripts/return-check.mjs"

import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, readJson, writeJsonAtomic, sanitizeId } from './lib/tier.mjs';

export const MAX_BLOCKS = 2;
export const LINE_CAP = 60;

export function check(text) {
  const t = String(text || '');
  const lines = t.trim() ? t.trim().split('\n').length : 0;
  const missing = [];
  if (!/^\s*RESTATED:\s*\S/im.test(t)) missing.push('RESTATED');
  if (!/^\s*STATUS:\s*(DONE|PARTIAL|BLOCKED)\b/im.test(t)) missing.push('STATUS (DONE, PARTIAL or BLOCKED)');
  if (!/^\s*EVIDENCE:\s*\S/im.test(t)) missing.push('EVIDENCE');
  const reasons = [];
  if (missing.length) reasons.push(`the return has no ${missing.join(', no ')}`);
  if (lines > LINE_CAP) reasons.push(`the return is ${lines} lines; the cap is 40 and long logs belong in the run folder, cited by path`);
  return { ok: reasons.length === 0, reasons, lines, missing };
}

// One counter per (session, agent) so two agents in the same session each get
// their own two chances.
function countKey(input) {
  return sanitizeId(`${input.session_id || 'nosession'}-${input.agent_type || input.subagent_type || 'agent'}`);
}

function main() {
  let payload = '';
  try { payload = readFileSync(0, 'utf8'); } catch {}
  let input = null;
  try { input = JSON.parse(payload); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (input.stop_hook_active === true) return; // already inside a block; do not loop

  const text = String(input.last_assistant_message || '');
  if (!text.trim()) return;
  const r = check(text);
  if (r.ok) return;

  const path = join(DIR, 'return-blocks.json');
  const store = readJson(path) || {};
  const key = countKey(input);
  const n = Number(store[key]) || 0;
  if (n >= MAX_BLOCKS) return; // let it finish; the ledger will flag the shape
  store[key] = n + 1;
  store.updated = new Date().toISOString();
  try { writeJsonAtomic(path, store); } catch {}

  const reason = `orchestrate: ${r.reasons.join('; ')}. Return in the packet's schema and nothing else: TASK, RESTATED (two lines), STATUS, BRANCH, WORKTREE, CHANGED, EVIDENCE (commands run and result tails, or paths), NOT VERIFIED, QUESTIONS. At most 40 lines. Do not redo the work; rewrite the return.`;
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'SubagentStop', decision: 'block', reason },
  }));
}

// Only when run as a hook, not when a test imports the pure functions above.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
  process.exit(0);
}
