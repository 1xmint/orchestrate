// lib/pause.mjs — the pause record: one small file in the project's
// .orchestrator folder that says the session's last turn ended on an API error
// (a usage limit among them) and is waiting. docs/pause.md has the table of
// who writes it, what wakes the session and what the band shows.
//
// persist-check.mjs writes it at StopFailure. It is cleared at the next
// ordinary Stop and the next prompt of the same session, so the two places that
// already run every turn do it and nothing new is registered. The band reads it
// through `readPause` and never writes. Nothing here throws: a file that is
// missing, unreadable or not a record reads as "no pause".
//
// The record is marked cleared (`cleared`, `clearedBy`), not deleted. The one
// thing nobody has checked is whether a subscription limit reaches StopFailure
// as `rate_limit`; a deleted file would take the answer with it.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, writeJsonAtomic } from './tier.mjs';

export const PAUSE_REL = join('.orchestrator', 'pause.json');
export const PAUSE_KINDS = ['usage_limit', 'api_error'];

export const pausePath = root => join(String(root || ''), PAUSE_REL);

// The folder the record lives in: the git root of the payload's cwd, or the cwd
// itself outside a repository; null when the payload names no folder. The
// writer, the two clearers and the band all call this, so they cannot disagree.
export function pauseRoot(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  return findRepoRoot(cwd) || cwd;
}

// What the host called the failure, or 'unknown' when the payload said nothing
// usable. The docs pages do not list StopFailure's input fields (the SDK type
// does: `error`), so anything but a non-empty string is unknown, never guessed.
export function errorKind(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s ? s.slice(0, 64) : 'unknown';
}

// The record for one failure. Pure. "keep-going stays on" is said only when it
// is true: a session that never armed it gets the same sentence without it.
export function pauseRecord({ error, session = null, now = new Date(), armed = true } = {}) {
  const e = errorKind(error);
  const limit = e === 'rate_limit';
  const keep = armed ? '; keep-going stays on' : '';
  return {
    kind: limit ? 'usage_limit' : 'api_error',
    error: e,
    at: new Date(now).toISOString(),
    session: session == null || session === '' ? null : String(session),
    text: limit ? `Paused for the usage limit${keep}.` : `Stopped on an API error (${e})${keep}.`,
  };
}

// A record from the file's text, cleared or not; null when it is not one.
export function parsePause(text) {
  let rec;
  try { rec = JSON.parse(text); } catch { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (!PAUSE_KINDS.includes(rec.kind) || typeof rec.at !== 'string' || typeof rec.text !== 'string') return null;
  return rec;
}

function readRaw(root) {
  if (!root) return null;
  try { return parsePause(readFileSync(pausePath(root), 'utf8')); } catch { return null; }
}

// The pause that is on right now, or null. With `session`, a record another
// session wrote reads as none: a band must not show a pause that is not its own.
export function readPause(root, { session } = {}) {
  const rec = readRaw(root);
  if (!rec || rec.cleared) return null;
  if (session !== undefined && rec.session !== (session == null || session === '' ? null : String(session))) return null;
  return rec;
}

// The hooks write state files (this record, and the band's in lib/band.mjs) into
// the project's .orchestrator folder. They are this computer's state, not the
// project's, and `git add -A` would otherwise commit them: run-init.mjs keeps
// .orchestrator out of git only for a ledger, and a project page alone does not.
// So a small .gitignore beside them names them. One the user wrote is left as it
// is; ours is recognised by its first line and topped up with any name it lacks.
// It names itself too, so in a project whose .orchestrator folder git can see,
// the plugin's own bookkeeping never shows as a file to commit.
export const STATE_FILES = ['.gitignore', 'band.json', 'pause.json', '*.tmp'];
const IGNORE_HEAD = "# Written by the orchestrate plugin's hooks: this computer's state, not project files.";
export function ignoreStateFiles(root) {
  if (!root) return false;
  const p = join(String(root), '.orchestrator', '.gitignore');
  try {
    if (!existsSync(p)) { writeFileSync(p, [IGNORE_HEAD, ...STATE_FILES, ''].join('\n')); return true; }
    const text = readFileSync(p, 'utf8');
    if (!text.startsWith(IGNORE_HEAD)) return false;
    const have = new Set(text.split(/\r?\n/).map(l => l.trim()));
    const missing = STATE_FILES.filter(n => !have.has(n));
    if (missing.length) appendFileSync(p, (text.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n');
    return true;
  } catch { return false; }
}

// With `create` false (the StopFailure hook's choice) it writes only where the
// project's .orchestrator folder already exists, as the band does: the hook runs
// in every folder a session opens, and a project the plugin has done nothing in
// must not get a folder for one API error.
export function writePause(root, rec, { create = true } = {}) {
  if (!root || !rec) return false;
  try {
    if (!create && !existsSync(join(String(root), '.orchestrator'))) return false;
    writeJsonAtomic(pausePath(root), rec);
    ignoreStateFiles(root);
    return true;
  } catch { return false; }
}

// Marks this session's record cleared. `by` says which end of the pause it was
// ('stop' or 'prompt'). A record another session wrote is left alone; one with
// no session on it could never be claimed, so any session clears it. Returns
// true only when it wrote.
export function clearPause(root, session, by, now = new Date()) {
  const rec = readRaw(root);
  if (!rec || rec.cleared) return false;
  if (rec.session != null && String(rec.session) !== String(session)) return false;
  return writePause(root, { ...rec, cleared: new Date(now).toISOString(), clearedBy: by });
}
