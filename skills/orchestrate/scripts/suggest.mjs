#!/usr/bin/env node
// suggest.mjs — the suggestions outbox. Helpers leave one improvement
// suggestion in their return (`SUGGEST: <text>` for Claude helpers, a
// `suggestion` field for Codex workers); this file is where those land.
//
// One file, across every repo, at ~/.claude/orchestrate/suggestions.jsonl —
// the subject is the plugin, not a repo. Nothing reads it automatically: no
// hook, no skill text, no injection into anyone's context. The lead reads it
// on request with `show`, and can note something itself with `add`.
//
// Rows dedupe on trimmed text: a repeat bumps `count` and `last` instead of
// growing the file. Text is capped at 240 chars; the file keeps the last 300
// rows.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR } from './lib/tier.mjs';

export const SUGGESTIONS_PATH = join(DIR, 'suggestions.jsonl');
export const MAX_ROWS = 300;
export const MAX_TEXT = 240;

export function readSuggestions(path = SUGGESTIONS_PATH) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

function writeSuggestions(rows, path) {
  mkdirSync(dirname(path), { recursive: true });
  const trimmed = rows.slice(-MAX_ROWS);
  writeFileSync(path, trimmed.map(r => JSON.stringify(r)).join('\n') + (trimmed.length ? '\n' : ''));
}

// Add one suggestion, or bump the count of an existing one with the same
// (trimmed, capped) text. Returns the stored text, or null when there was
// nothing to add.
export function addSuggestion(text, { source = null, path = SUGGESTIONS_PATH, now = () => new Date().toISOString() } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const capped = trimmed.slice(0, MAX_TEXT);
  const rows = readSuggestions(path);
  const ts = now();
  const existing = rows.find(r => r.text === capped);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.last = ts;
    if (source && !existing.source) existing.source = source;
  } else {
    rows.push({ text: capped, count: 1, first: ts, last: ts, source: source || null });
  }
  writeSuggestions(rows, path);
  return capped;
}

// Print then empty, so a review leaves nothing behind for the next one.
export function clearSuggestions(path = SUGGESTIONS_PATH) {
  if (existsSync(path)) writeFileSync(path, '');
}

export function formatShow(rows) {
  if (!rows.length) return 'No suggestions.';
  const sorted = [...rows].sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
  return sorted
    .map(r => `${r.count > 1 ? `[${r.count}x] ` : ''}${r.text}${r.source ? ` (${r.source})` : ''} — last ${r.last}`)
    .join('\n');
}

// One suggestion per `- ` bullet in a markdown file (a run's seed notes, say).
// Everything after the marker, on that line, is the text.
export function seedFromMarkdown(mdText, opts = {}) {
  const lines = String(mdText || '').split('\n');
  const added = [];
  for (const line of lines) {
    const m = /^\s*-\s+(.+)$/.exec(line);
    if (!m) continue;
    const stored = addSuggestion(m[1], opts);
    if (stored) added.push(stored);
  }
  return added;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'add') {
    const text = args[1];
    if (!text) { console.error('usage: suggest.mjs add "<text>"'); process.exitCode = 1; return; }
    addSuggestion(text, { source: 'lead' });
    console.log('added.');
    return;
  }
  if (cmd === 'show') {
    const clear = args.includes('--clear');
    const rows = readSuggestions();
    console.log(formatShow(rows));
    if (clear) clearSuggestions();
    return;
  }
  if (cmd === '--seed') {
    const file = args[1];
    if (!file) { console.error('usage: suggest.mjs --seed <file.md>'); process.exitCode = 1; return; }
    const text = readFileSync(resolvePath(file), 'utf8');
    const added = seedFromMarkdown(text, { source: `seed:${file}` });
    console.log(`seeded ${added.length} suggestion(s).`);
    return;
  }
  console.error('usage: suggest.mjs add "<text>" | show [--clear] | --seed <file.md>');
  process.exitCode = 1;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
