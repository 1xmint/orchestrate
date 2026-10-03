// lib/band.mjs — what the hooks do for the band: write one small record and
// never anything else. The band itself is a mod (hooks/band.mjs) that only
// reads it; docs/band.md says what it shows and where each line comes from.
//
//   router.mjs         at a real prompt          -> working (the next open item, else the goal)
//   persist-check.mjs  at a Stop, not in a helper -> working | needs | idle
//
// The record is `<project root>/.orchestrator/band.json`, in the same folder as
// the pause record and found the same way (`pauseRoot`), so the hooks that write
// it and the mod that reads it name one file. It is written only where the
// plugin's `.orchestrator` folder already exists: a hook that ran in every folder
// a session opens would leave an untracked folder behind in projects the plugin
// has done nothing in. Nothing here throws, and nothing here changes what a hook
// prints or decides: a failed write is a silent skip.
//
// The pure half (the line, the record's shape, what a Stop leaves) is in
// lib/band-line.mjs, which imports nothing so the mod can import it too.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic, readTail } from './tier.mjs';
import { pauseRoot, ignoreStateFiles } from './pause.mjs';
import { nextOpen } from './runs.mjs';
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
export function recordBand({ cwd, session = null, kind, text = '', now = new Date(), create = false } = {}) {
  try {
    const root = pauseRoot(cwd);
    if (!root) return null;
    const rec = bandRecord({ session, kind, text, now });
    return writeBand(root, rec, { create }) ? rec : null;
  } catch { return null; }
}

// The next open item, from the run this session is bound to and the project
// page; '' when there is none to name (nothing open, or every task done). The
// page is looked for at the run's root, then the git root, then the payload's
// folder, because the page sits at the repository root and a session may have
// started below it.
export function openItem(state, cwd) {
  try {
    const run = state && state.run;
    let runText = '';
    if (run && run.runMd) { try { runText = readFileSync(run.runMd, 'utf8'); } catch {} }
    let project = null;
    for (const r of [run && run.root, pauseRoot(cwd), cwd]) {
      if (r) { project = readProject(r); if (project) break; }
    }
    const n = nextOpen(runText, project);
    return n.state === 'open' && n.text ? withoutTaskIds(n.text) : '';
  } catch { return ''; }
}

// What the session is for, in the user's words: the keep-going goal while it is
// on, else the first request the router pinned. '' when neither exists.
export function sessionGoal(state) {
  const p = state && state.persist;
  return (p && p.armed && p.goal) || (state && state.goal) || '';
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
