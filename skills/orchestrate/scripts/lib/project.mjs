// lib/project.mjs — the project page: `.orchestrator/PROJECT.md`, one short file
// per repo that says what the work is for, where it stands and what the next
// steps are, each with what the user will be able to see. The plugin never
// guesses its content; it reads what the lead wrote, shows its head at the
// start of a session, after a compaction and on resume, and copies the
// template when asked. Template: assets/PROJECT.md (at most MAX_LINES lines).
//
// A blank in the template is `<…>`: angle brackets whose text contains an
// ellipsis. That is how code tells an unfilled section from a filled one, and
// it cannot be mistaken for ordinary text such as `<html>`.
//
// Nothing here throws. Only ensureProject writes, and only that one file.

import { readFileSync, existsSync, mkdirSync, copyFileSync } from './node.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 60;
export const HEAD_CAP = 1200;   // bytes shown at session start, after compaction, on resume
export const PROJECT_REL = join('.orchestrator', 'PROJECT.md');
export const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'PROJECT.md');

const BLANK = /<[^<>\n]*…[^<>\n]*>/;
const bytes = s => Buffer.byteLength(s, 'utf8');

export function projectPath(root) { return join(String(root || ''), PROJECT_REL); }

// The page's text, or null when it is absent or unreadable.
export function readProject(root) {
  if (!root) return null;
  try { return readFileSync(projectPath(root), 'utf8'); } catch { return null; }
}

// { 'What this is for': [lines], ... } in file order. Lines before the first
// `##` heading are ignored.
export function sections(text) {
  const out = {};
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(line);
  }
  return out;
}

const filled = lines => (lines || []).map(l => l.trim()).filter(l => l && !BLANK.test(l));

// The numbered steps under Next with every blank left out.
export function nextSteps(text) {
  const body = sections(text).Next || [];
  return body.map(l => l.trim()).filter(l => /^\d+[.)]\s+\S/.test(l) && !BLANK.test(l));
}

// The one-line statement of purpose, blanks left out; '' when not filled.
export function purpose(text) {
  return filled(sections(text)['What this is for']).join(' ');
}

// What a session needs back in view: What this is for, Where it stands and the
// numbered Next steps, blanks omitted, clipped to `cap` bytes at a line end.
// '' when none of them is filled.
export function projectHead(text, cap = HEAD_CAP) {
  const s = sections(text);
  const parts = [];
  const why = purpose(text);
  if (why) parts.push(`What this is for: ${why}`);
  const where = filled(s['Where it stands']);
  if (where.length) parts.push(`Where it stands: ${where.join(' ')}`);
  const steps = nextSteps(text);
  if (steps.length) parts.push(`Next:\n${steps.join('\n')}`);
  let out = '';
  for (const l of parts.join('\n').split('\n')) {
    const next = out ? `${out}\n${l}` : l;
    if (bytes(next) > cap) { out = out ? `${out}\n…` : `${[...l].slice(0, 200).join('')}…`; break; }
    out = next;
  }
  return out;
}

// The shown form: the head of the first of `roots` that has a filled page, as
// one labelled block; '' when there is none. The router prints this at a
// session's first prompt, after a compaction, on resume and on "continue".
export function projectNote(...roots) {
  for (const r of roots) {
    const head = projectHead(readProject(r));
    if (head) return `[orchestrate · project] ${PROJECT_REL.replace(/\\/g, '/')}\n${head}`;
  }
  return '';
}

// Copies the template to <root>/.orchestrator/PROJECT.md when absent. Returns
// { path, action: 'created' | 'exists' | 'would-create' | 'failed' }.
export function ensureProject(root, { dryRun = false } = {}) {
  const path = projectPath(root);
  try {
    if (existsSync(path)) return { path, action: 'exists' };
    if (dryRun) return { path, action: 'would-create' };
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(TEMPLATE_PATH, path);
    return { path, action: 'created' };
  } catch { return { path, action: 'failed' }; }
}
