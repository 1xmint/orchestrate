// lib/band.mjs — what the hooks do for the band: write one small record and
// never anything else. The band itself is a mod (hooks/band.mjs) that only
// reads it; docs/band.md says what it shows and where each line comes from.
//
//   router.mjs         at a real prompt           -> working (the request, a resumed item, or nothing named)
//   persist-check.mjs  at a Stop, not in a helper -> working | needs | idle
//   turn-check.mjs     at a Stop it refuses       -> working, held for that Stop
//
// The record is `<project root>/.orchestrator/band.json`, in the same folder as
// the pause record and found the same way (`pauseRoot`), so the hooks that write
// it and the mod that reads it name one file. It is written only where the
// plugin's `.orchestrator` folder already exists: a hook that ran in every folder
// a session opens would leave an untracked folder behind in projects the plugin
// has done nothing in. Nothing here throws, and nothing here changes what a hook
// prints or decides: a failed write is a silent skip.
//
// The pure half (the line, the record's shape, what a prompt and a Stop leave)
// is in lib/band-line.mjs, which imports nothing so the mod can import it too.

import { existsSync, readFileSync, createHash } from './node.mjs';
import { join } from 'node:path';
import { writeJsonAtomic, readTail, withFileLock } from './tier.mjs';
import { pauseRoot, ignoreStateFiles } from './pause.mjs';
import { nextOpen, boundRun } from './runs.mjs';
import { readProject } from './project.mjs';
import { lastQuestion } from './asked.mjs';
import { lastAssistantText } from './commit-claim.mjs';
import { bandRecord, parseBand, withoutTaskIds } from './band-line.mjs';

export * from './band-line.mjs';

export const BAND_REL = join('.orchestrator', 'band.json');
export const bandPath = root => join(String(root || ''), BAND_REL);

// A record from the file, or null when it is absent, unreadable or not one.
export function readBand(root) {
  if (!root) return null;
  try { return parseBand(readFileSync(bandPath(root), 'utf8')); } catch { return null; }
}

// Writes the record. With `create` false (the hooks' choice) it writes only when
// the project's `.orchestrator` folder is already there. Returns true only when
// it wrote.
export function writeBand(root, rec, { create = false } = {}) {
  if (!root || !rec) return false;
  try {
    if (!create && !existsSync(join(root, '.orchestrator'))) return false;
    writeJsonAtomic(bandPath(root), rec);
    ignoreStateFiles(root);
    return true;
  } catch { return false; }
}

// Records one state for the session whose payload this is. The folder comes from
// the payload's `cwd` through `pauseRoot`, as the pause record's does. Returns
// the record written, or null.
export function recordBand({ cwd, session = null, kind, text = '', now = new Date(), since = null, create = false } = {}) {
  try {
    const root = pauseRoot(cwd);
    if (!root) return null;
    const rec = bandRecord({ session, kind, text, now, since });
    return writeBand(root, rec, { create }) ? rec : null;
  } catch { return null; }
}

// One Stop, named the same way by both Stop hooks: they get the same payload.
// The flag is part of it because the Stop after a refusal can close on the same
// words, and it is a different Stop.
export function stopKey(input) {
  const i = input || {};
  const parts = [i.session_id || null, i.transcript_path || null, typeof i.last_assistant_message === 'string' ? i.last_assistant_message : null, Boolean(i.stop_hook_active)];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

// How long a refusal's hold counts. Both Stop hooks have a five-second timeout
// in hooks.json, so the other one has finished well inside this.
export const HOLD_MS = 30000;

// What a Stop leaves, written under the record's lock. The two Stop hooks run
// side by side (one group in hooks.json, whose commands the host runs at once),
// and either may refuse the Stop. One that refuses writes `working` with this
// Stop's key as `hold` (turn-check.mjs); the other's write for the same Stop
// (needs, idle, a wait) then leaves that line alone, in whichever order the two
// ran, so a turn that goes on never shows "Needs you" or nothing. Returns the
// record written, or null.
export function recordStopBand({ cwd, session = null, kind, text = '', now = new Date(), since = null, hold = null, key = null } = {}) {
  try {
    const root = pauseRoot(cwd);
    if (!root || !existsSync(join(root, '.orchestrator'))) return null;
    return withFileLock(bandPath(root), () => {
      if (!hold && key) {
        const cur = readBand(root);
        const same = cur && cur.kind === 'working' && cur.hold === key
          && (cur.session == null ? null : String(cur.session)) === (session == null || session === '' ? null : String(session));
        const age = cur ? Number(now) - Date.parse(cur.at) : NaN;
        if (same && age >= -HOLD_MS && age <= HOLD_MS) return null;
      }
      const rec = bandRecord({ session, kind, text, now, since, hold });
      return writeBand(root, rec) ? rec : null;
    });
  } catch { return null; }
}

// The next open item, from the run this session is bound to and the project
// page; '' when there is none to name (nothing open, or every task done). A
// binding that no longer holds (the run closed, or stale: `boundRun`) names
// nothing from that run. The run's Pickup is left out: it is the lead's note to
// itself, not the user's words. The page is looked for at the run's root, then
// the git root, then the payload's folder, because the page sits at the
// repository root and a session may have started below it.
export function openItem(state, cwd) {
  try {
    const binding = state && state.run;
    const run = boundRun(binding);
    let runText = '';
    if (run) { try { runText = readFileSync(run.runMd, 'utf8'); } catch {} }
    let project = null;
    for (const r of [binding && binding.root, pauseRoot(cwd), cwd]) {
      if (r) { project = readProject(r); if (project) break; }
    }
    const n = nextOpen(runText, project, { pickup: false });
    return n.state === 'open' && n.text ? withoutTaskIds(n.text) : '';
  } catch { return ''; }
}

// What the session is for, in the user's words: the keep-going goal while it is
// on, else the first request the router pinned. '' when neither exists.
export function sessionGoal(state) {
  const p = state && state.persist;
  return (p && p.armed && p.goal) || (state && state.goal) || '';
}

// What a turn that goes on past a refused Stop is about. With keep-going on,
// the loop works toward the next open item, else the goal, re-read at each step.
// Otherwise the turn is still the one the user's last prompt started: the text
// that prompt put on the band (router.mjs keeps it as `bandText`), which is
// nothing when the prompt asked for nothing new. Never a stored item the prompt
// did not name.
export function turnText(state, cwd) {
  const p = state && state.persist;
  if (p && p.armed) return openItem(state, cwd) || sessionGoal(state);
  return state && typeof state.bandText === 'string' ? state.bandText : '';
}

// The question the turn closed on, or null. The Stop payload's own closing
// message first, the transcript tail when it carries none (as persist-check's
// commit check reads it).
export function stopQuestion(input) {
  try {
    let text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
    if (!text.trim() && input.transcript_path) text = lastAssistantText(readTail(input.transcript_path, 131072));
    return lastQuestion(text);
  } catch { return null; }
}
