// lib/compaction-snapshot.mjs — the plugin's own checkpoint, written from the
// transcript at each compaction instead of only asked of the lead.
//
// The checkpoint ask fires correctly (context-advice.mjs's post-compaction
// ask), but an ask alone does not reach a written file: one live run's lead
// wrote nothing when asked four times. A compaction does not replace the
// transcript file, though — verified on a real transcript this session
// (12,743 lines, 70 `system/compact_boundary` records, every turn before the
// first boundary still in the file) — so the plugin can write the checkpoint
// itself, from the turns just before the newest boundary, into the exact path
// `newestCheckpoint()` (lib/context-advice.mjs) already checks. No new hook
// event, no unconfirmed input, no time window.
//
// Idempotent: a file already at `checkpointPath` — the lead's own, or the
// other hook that calls this — is left alone. Reuses lib/context-scan.mjs's
// `isBoundary` and lib/context-advice.mjs's `checkpointPath`; does not add a
// second way to detect a boundary record. Never throws: any error here
// returns null and writes nothing, so a hook that calls this can never fail
// on its account.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { CONTEXT_DIR, isBoundary } from './context-scan.mjs';
import { checkpointPath } from './context-advice.mjs';
import { sectionExcerpt } from './resume.mjs';
import { loadSession } from './tier.mjs';
import { unreturned } from './recover.mjs';

const FIELD_CAP = 300;

function clip(text, cap = FIELD_CAP) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > cap ? `${t.slice(0, cap - 1).trimEnd()}…` : t;
}

// The last `cap` characters of `text`, for "what it was doing" — the end of a
// long answer is the part worth keeping, not the start.
function clipTail(text, cap = FIELD_CAP) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > cap ? `…${t.slice(t.length - cap + 1).trimStart()}` : t;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(b => {
    if (typeof b === 'string') return b;
    if (!b) return '';
    if (typeof b.text === 'string') return b.text;
    // A tool_result block's own `content` is a string or another array of
    // blocks, the same shape one level up (lib/measure.mjs sees the same).
    if (b.content != null) return toolResultText(b.content);
    return '';
  }).join('\n');
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TEST_LINE = /(\bTests?:\s*\d+|\bpassed?\b[:=]?\s*\d+|\bfailed?\b[:=]?\s*\d+|✔|✖|✓|✗|\bPASS\b|\bFAIL\b)/i;

// One forward pass of the transcript: the newest boundary, a running count of
// boundaries seen, and the state of "turns since the previous boundary" —
// reset each time a boundary is crossed, so by the last line it holds only
// what happened before the newest one. `firstUserText` is never reset: it is
// the session's own first user prompt, used only when no run is bound.
function scanTranscript(text) {
  let boundaryCount = 0;
  let lastBoundary = null;
  let firstUserText = null;
  let lastUserText = null;
  let lastAssistantText = null;
  let testLine = null;
  let paths = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (isBoundary(rec)) {
      boundaryCount++;
      const m = rec.compactMetadata || {};
      // Capture the segment that just ended (the turns before THIS boundary)
      // before resetting for the next one; a later boundary overwrites this,
      // so what is left at the end is always the segment before the newest.
      lastBoundary = {
        n: boundaryCount, trigger: m.trigger || null, at: rec.timestamp || null,
        lastUserText, lastAssistantText, testLine, paths: paths.slice(-8),
      };
      lastUserText = null; lastAssistantText = null; testLine = null; paths = [];
      continue;
    }
    if (rec.type === 'user' && rec.message) {
      const t = textOf(rec.message.content);
      if (t.trim()) {
        if (firstUserText == null) firstUserText = t;
        lastUserText = t;
      }
      const rt = toolResultText(rec.message.content);
      const m = rt.split('\n').filter(l => TEST_LINE.test(l));
      if (m.length) testLine = m[m.length - 1].trim();
      continue;
    }
    if (rec.type === 'assistant' && rec.message) {
      const t = textOf(rec.message.content);
      if (t.trim()) lastAssistantText = t;
      for (const b of Array.isArray(rec.message.content) ? rec.message.content : []) {
        if (!b || b.type !== 'tool_use' || !EDIT_TOOLS.has(b.name)) continue;
        const p = b.input && (b.input.file_path || b.input.path);
        if (!p || typeof p !== 'string') continue;
        const i = paths.indexOf(p);
        if (i >= 0) paths.splice(i, 1);
        paths.push(p);
      }
    }
  }
  if (!lastBoundary) return null;
  return {
    n: lastBoundary.n, trigger: lastBoundary.trigger,
    firstUserText,
    lastUserText: lastBoundary.lastUserText,
    lastAssistantText: lastBoundary.lastAssistantText,
    testLine: lastBoundary.testLine,
    paths: lastBoundary.paths,
  };
}

// Helpers dispatched this session with no return on record yet, one plain
// line each, newest first, at most three — the same fact router.mjs's
// unreturnedNote reads for the recover notice, without the sentence wrapper.
function helpersInFlight(session) {
  try {
    const state = loadSession(session);
    if (!state) return [];
    return unreturned(state, {}).slice(-3).reverse().map(u => clip(u.slug || u.task || 'an earlier step', 80));
  } catch { return []; }
}

function buildBody({ n, trigger, goal, lastUser, lastAssistant, paths, testLine, helpers }) {
  const L = [];
  L.push(`This is a checkpoint the plugin wrote from the transcript at compaction ${n}${trigger ? ` (${trigger})` : ''}, not the lead's own judgment.`);
  L.push('');
  L.push(`Goal: ${goal || 'not seen in the transcript'}`);
  L.push('');
  L.push(`Last message before compaction: ${lastUser || 'none seen'}`);
  L.push('');
  L.push(`What it was doing: ${lastAssistant || 'none seen'}`);
  L.push('');
  L.push(`Files touched: ${paths.length ? paths.join(', ') : 'none seen'}`);
  L.push('');
  L.push(`Last test result: ${testLine || 'none seen'}`);
  L.push('');
  L.push(`Helpers in flight: ${helpers.length ? helpers.join('; ') : 'none'}`);
  return `${L.join('\n')}\n`;
}

// `ctx`: { dir (CONTEXT_DIR override, tests only), runMd, runDir }. `runMd`
// names the bound run's RUN.md, whose Goal section wins over the session's
// own first prompt; `runDir` is the run folder a copy lands under, at
// `<runDir>/checkpoints/<same name>`, because that is what "pick it up
// tomorrow" reads.
export function writeCompactionSnapshot({ session, reading, transcriptPath, ctx = {} } = {}) {
  try {
    if (!reading || !reading.compaction) return null;
    const dir = ctx.dir || CONTEXT_DIR;
    const path = checkpointPath(session, reading, dir);
    if (existsSync(path)) return path;
    if (!transcriptPath) return null;
    let text = '';
    try { text = readFileSync(transcriptPath, 'utf8'); } catch { return null; }
    const found = scanTranscript(text);
    if (!found) return null;

    let goal = '';
    if (ctx.runMd) {
      try { goal = clip(sectionExcerpt(readFileSync(ctx.runMd, 'utf8'), ['Goal'], FIELD_CAP, { intro: false })); } catch { goal = ''; }
    }
    if (!goal) goal = clip(found.firstUserText, FIELD_CAP);

    const body = buildBody({
      n: found.n,
      trigger: found.trigger,
      goal,
      lastUser: clip(found.lastUserText, FIELD_CAP),
      lastAssistant: clipTail(found.lastAssistantText, FIELD_CAP),
      paths: found.paths,
      testLine: found.testLine ? clip(found.testLine, 200) : null,
      helpers: helpersInFlight(session),
    });

    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, path);

    if (ctx.runDir) {
      try {
        const copyDir = join(ctx.runDir, 'checkpoints');
        mkdirSync(copyDir, { recursive: true });
        copyFileSync(path, join(copyDir, basename(path)));
      } catch { /* the on-disk checkpoint still stands without its copy */ }
    }
    return path;
  } catch { return null; }
}
