// lib/recover.mjs — what to say when work may have been lost: dispatches with
// no return seen yet, plans nobody has touched in days, and the facts a
// compaction drops. Grouped together because all three exist for the same
// moment — the lead resuming after something interrupted it — not because
// they share code.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIR, readJson, writeJsonAtomic, staleRunsUnder,
} from './tier.mjs';
import { normalizeRole } from './prices.mjs';
import { cappedNote, runningNative, helperFiles } from './workers.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Dispatches with no matching return. Matched in order, by role and, when both
// sides carry one, by task id. Said only at the moments work may have died —
// a resume, a compaction, a usage limit — because a helper still running looks
// exactly the same from here. `native` (lib/workers.mjs's `runningNative`, when
// the caller has one) excludes anything it still counts as alive: a helper
// mid-task reads identically to one that died, so without this every one of
// them would be reported as gone. It only narrows the list, never closes it —
// `runningNative` itself can't see a helper stopped by a limit versus one still
// working, so what remains is "not seen back yet", not "never coming back".
// The helpers lib/workers.mjs's own concurrency check still counts as alive,
// for this session's transcript — the same read guard-agent.mjs uses to admit
// a new dispatch, reused here so "never returned" only ever means what it says.
export function stillRunningNative(input, state) {
  try {
    return runningNative(Array.isArray(state.dispatches) ? state.dispatches : [], {
      returned: Array.isArray(state.returned) ? state.returned : [],
      files: helperFiles(input && input.transcript_path),
    });
  } catch { return []; }
}

export function unreturned(state, { native = [] } = {}) {
  const returns = (state && Array.isArray(state.returned) ? state.returned : []).map(r => ({ ...r, used: false }));
  const stillAlive = (native || []).map(w => ({ role: normalizeRole(w.role), task: w.task || null, used: false }));
  const out = [];
  for (const d of (state && Array.isArray(state.dispatches) ? state.dispatches : [])) {
    const role = normalizeRole(d.agent);
    const hit = returns.find(r => !r.used && r.agent === role && (!d.task || !r.task || r.task === d.task));
    if (hit) { hit.used = true; continue; }
    const alive = stillAlive.find(w => !w.used && w.role === role && (!d.task || !w.task || w.task === d.task));
    if (alive) { alive.used = true; continue; }
    // `d.task` is a numeric packet id when one was named — never shown to the
    // user. `d.key` is only ever that id's fallback: the dispatch's own first
    // line of description, used as the slug precisely when there is no id.
    out.push({ role, task: d.task || d.key || null, slug: d.task ? null : (d.key || null), progress: d.progress || null, at: d.at });
  }
  return out;
}

// One plain sentence per helper with no return seen yet, newest first, at most
// three. No role names and no task ids — those are for the ledger, not the
// user reading this over the model's shoulder; what to say is the task's own
// slug when one is on record, else "an earlier step". The tail that follows
// still says the list only narrows, never closes.
export function unreturnedNote(state, { native = [], max = 3 } = {}) {
  const list = unreturned(state, { native });
  if (!list.length) return '';
  const shown = list.slice(-max).reverse();
  const sentences = shown.map(u => {
    const what = u.slug || 'an earlier step';
    const notes = u.progress ? `its notes are at ${u.progress}` : 'no notes file was named';
    return `A helper working on ${what} has not reported back; ${notes}.`;
  });
  return `[orchestrate · recover] ${sentences.join(' ')} The still-running check only narrows this list, so one of these may yet be working. A helper stopped by a limit or the session ending leaves its notes and branch; resuming the stopped agent re-reads its whole context at full price.`;
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

// Facts the lead lost with the summary and cannot see from here: how many
// summaries this session has had, how many helpers were sent, and when the
// advisor last was. No instruction; the card that follows carries those.
export function compactionFact(state) {
  const sent = Array.isArray(state && state.dispatches) ? state.dispatches : [];
  let last = -1;
  sent.forEach((d, i) => { if (normalizeRole(d && d.agent) === 'orch-advisor') last = i; });
  const since = sent.length - 1 - last;
  const advisor = last < 0 ? 'never' : since === 0 ? 'the most recent helper' : `${since} helper${since === 1 ? '' : 's'} ago`;
  return `[orchestrate · after compaction] The conversation was summarised. The card below was in view before the summary and is not in it. Compaction ${(state && state.compactions) || 1} of this session. ${sent.length} helper${sent.length === 1 ? '' : 's'} sent so far; orch-advisor last sent: ${advisor}.`;
}
