// lib/files.mjs — the paths under ~/.claude/orchestrate and the small safe file
// helpers, with nothing else loaded. lib/tier.mjs re-exports all of it, so
// every importer of tier keeps working; a hook that needs only these (the
// shell guard, which runs before every shell command) imports this file and
// skips tier's run, install and transcript modules (about 8 ms a call,
// measured 2026-10-03).
// No network, no child processes.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from './node.mjs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

export const HOME = homedir();
export const DIR = join(HOME, '.claude', 'orchestrate');
export const SESSIONS_DIR = join(DIR, 'sessions');

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  // On Windows a rename can fail while another process holds the target open
  // (a reader, an antivirus scan): the error still reaches the caller, but the
  // temporary file does not stay behind.
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

export function findRepoRoot(start) {
  if (!start) return null;
  let d = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

export function sanitizeId(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

export function sessionPath(sessionId) {
  return join(SESSIONS_DIR, `${sanitizeId(sessionId)}.json`);
}
