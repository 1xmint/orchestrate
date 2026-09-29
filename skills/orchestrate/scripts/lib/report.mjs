// lib/report.mjs — reads a helper's return text against the shape
// assets/packet.md asks for, and answers one question: is there a line of
// actual evidence behind the claim? Pure, no I/O beyond reading the shipped
// schema once for its field names.
//
// A return that says DONE and never points at a test, a command, a count, a
// file:line or a path is a claim, not a check. ledger.mjs downgrades that
// case to PARTIAL; nothing here writes anything or corrects the text — a
// missing field is reported, never invented.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskIdIn } from './task-id.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(__dirname, '..', '..', 'assets', 'worker-report.schema.json');

// Read once, cached: the codex JSON schema and the plain-text packet.md
// return use different shapes for the same facts (EVIDENCE here is
// `checks[].evidence` there), so a drift test can check the two haven't
// grown apart without either file importing the other.
let _schema;
export function schemaFieldNames() {
  if (_schema) return _schema;
  let s = {};
  try { s = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')); } catch { s = {}; }
  const top = Object.keys((s && s.properties) || {});
  const checkItem = s && s.properties && s.properties.checks && s.properties.checks.items;
  const checks = checkItem && checkItem.properties ? Object.keys(checkItem.properties) : [];
  _schema = { top, checks };
  return _schema;
}

// Field labels a return is split on, so an EVIDENCE section stops at the
// next one of these rather than swallowing the rest of the return.
const FIELD_LABELS = ['TASK', 'RUN', 'STATUS', 'ROLE', 'BRANCH', 'CHANGED', 'EVIDENCE', 'NOT VERIFIED', 'QUESTIONS', 'SUGGEST', 'VERDICT', 'FINDINGS', 'OUTCOME', 'PROOF', 'NOT CHECKED', 'NEEDS A DECISION', 'FULL REPORT'];

function labelRe(name) {
  return new RegExp(`^\\s*${name}\\s*[:\\-–—]`, 'i');
}

// The text under a field's label, from its own line (with the label
// stripped) through the line before the next known label, or the end.
function section(text, name) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex(l => labelRe(name).test(l));
  if (start === -1) return null;
  const rest = [lines[start].replace(labelRe(name), '').trim()];
  for (let i = start + 1; i < lines.length; i++) {
    if (FIELD_LABELS.some(f => labelRe(f).test(lines[i]))) break;
    rest.push(lines[i]);
  }
  return rest.join('\n');
}

// A line reads as evidence when it names: a test file, `node --test`, a
// count ("12 pass", "3 failed", "12/12"), a file:line, or a path — not just
// any non-empty prose under the heading ("looks good" is not evidence).
export const EVIDENCE_LINE = /(\.test\.[a-z]+\b)|(\bnode\s+(--test|scripts\/)\S*)|(\b\d+\s*\/\s*\d+\b)|(\b\d+\s+(pass(ing|ed)?|fail(ing|ed)?)\b)|([\w.\-]+:\d+)|([\w.\-]+\/[\w./\\-]+)/i;

// Helpers open with PROOF: and may carry their checks only there, so it counts
// like EVIDENCE. An empty PROOF, or "none", has no evidence shape and does not.
function hasEvidenceLine(text) {
  return ['EVIDENCE', 'PROOF'].some(name => {
    const sec = section(text, name);
    return sec ? sec.split('\n').some(l => l.trim() && EVIDENCE_LINE.test(l)) : false;
  });
}

// checkReturn(text) -> { ok, missing, evidence, status }
//
// - missing: 'task' and/or 'status' when those fields are absent; 'evidence'
//   added only when STATUS is DONE and no evidence line was found (PARTIAL
//   and BLOCKED returns are not required to carry one).
// - evidence: whether an evidence line was found at all, regardless of
//   status — callers that want the raw fact, not the DONE-specific rule,
//   read this.
// - Never throws: a malformed or non-string return reports missing fields
//   rather than raising.
export function checkReturn(text) {
  const t = typeof text === 'string' ? text : String(text == null ? '' : text);
  const missing = [];

  if (!taskIdIn(t, { caseInsensitive: true })) missing.push('task');

  const statusMatch = /^\s*STATUS\s*[:\-–—]\s*(DONE|PARTIAL|BLOCKED)\b/im.exec(t);
  const status = statusMatch ? statusMatch[1].toUpperCase() : null;
  if (!status) missing.push('status');

  const evidence = hasEvidenceLine(t);
  if (status === 'DONE' && !evidence) missing.push('evidence');

  return { ok: missing.length === 0, missing, evidence, status };
}
