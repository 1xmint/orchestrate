// helper-compaction.mjs — was this compaction hook fired by a helper's own
// compaction? The host sends a helper's SessionStart(compact) and PostCompact
// with no agent_id, the lead's session_id and the lead's transcript_path
// (anthropics/claude-code#91910), so the input alone cannot tell.
//
// The helper's own transcript can. A helper's compact_boundary is on file
// before its compaction hook runs: in all 379 helper compactions on the audit
// machine (09-30) the boundary is stamped 0.2 to 10.7 s before the hook's own
// record. The lead's hook runs before the lead's boundary is written, so the
// lead transcript cannot tell the two apart; helper transcripts are the only
// signal. Replayed over the same machine with a 10 s window: 378 of 379 helper
// compactions caught, 0 of 354 lead compactions misjudged as a helper's.
//
// When unsure it says "not a helper": a helper seeing a stray card is today's
// cost, the lead losing its card after a real compaction is worse.

import { readdirSync, statSync, readFileSync } from './node.mjs';
import { join, dirname } from 'node:path';

export const HELPER_COMPACT_WINDOW_MS = 10000;

// Helper transcripts live at <lead transcript dir>/<session_id>/subagents/*.jsonl.
// Only files written within the window are read: a helper that just compacted
// has just written its file, so an older file cannot hold a fresh boundary.
export function helperJustCompacted(input, { now = Date.now(), windowMs = HELPER_COMPACT_WINDOW_MS } = {}) {
  try {
    if (!input || !input.transcript_path || !input.session_id) return false;
    const dir = join(dirname(input.transcript_path), String(input.session_id), 'subagents');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, name);
      if (now - statSync(file).mtimeMs > windowMs) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('compact_boundary')) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (!r || r.subtype !== 'compact_boundary') continue;
        const t = Date.parse(r.timestamp);
        if (t <= now && now - t <= windowMs) return true;
      }
    }
  } catch {}
  return false;
}
