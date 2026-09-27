// lib/commit-claim.mjs — pure text matching for the Stop hook's commit check:
// pull the model's last words out of a transcript tail, decide whether they
// claim the work is or is not committed, and say whether that claim
// contradicts what `git status` actually shows. No file or process access
// here; persist-check.mjs supplies the transcript tail and the git facts.

// Phrases that claim work is NOT committed. Kept as literal phrases (not a
// bare "commit" stem) so a sentence about committing to a plan, or the word
// "commit" alone, never trips this.
const NOT_COMMITTED_PHRASES = [
  'not committed', "haven't committed", 'have not committed',
  'nothing is committed', 'uncommitted', 'not yet committed',
  'left uncommitted', "didn't commit", 'did not commit',
];

const notCommittedRe = new RegExp(
  NOT_COMMITTED_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|'),
  'gi',
);

const committedWordRe = /\bcommitted\b/i;
const commitsAreInRe = /\bcommits\s+are\s+in\b/i;

// One sentence's claim: 'not' | 'committed' | 'mixed' | null. The negation
// phrase is stripped out before the bare "committed" check, because every
// NOT_COMMITTED phrase except "uncommitted" and the two "commit" ones
// contains the word "committed" itself ("have not committed") — without the
// strip, every not-committed claim would misread as also claiming committed.
function classifySentence(sentence) {
  const matched = sentence.match(notCommittedRe);
  const hasNot = !!matched;
  const stripped = hasNot ? sentence.replace(notCommittedRe, ' ') : sentence;
  const hasCommitted = committedWordRe.test(stripped) || commitsAreInRe.test(stripped);
  if (hasNot && hasCommitted) return 'mixed';
  if (hasNot) return 'not';
  if (hasCommitted) return 'committed';
  return null;
}

// The whole message's claim, or null when it makes none. A sentence naming
// both kinds is a mixed claim and so is a message whose sentences disagree
// with each other — either way, nothing here is safe to contradict.
export function classifyClaim(text) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const kinds = new Set();
  for (const s of sentences) {
    const k = classifySentence(s);
    if (k === 'mixed') return 'mixed';
    if (k) kinds.add(k);
  }
  if (kinds.has('not') && kinds.has('committed')) return 'mixed';
  if (kinds.has('not')) return 'not-committed';
  if (kinds.has('committed')) return 'committed';
  return null;
}

// The last assistant message's text, read from a JSONL transcript tail.
// Tool-use blocks are ignored; multiple text blocks in one message are
// joined; only the most recent assistant message (by line order) counts, so
// a user message after it, or an earlier assistant turn, cannot supply it.
export function lastAssistantText(tail) {
  let last = '';
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type !== 'assistant' || !rec.message || !Array.isArray(rec.message.content)) continue;
    const texts = rec.message.content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim())
      .map(b => b.text);
    if (texts.length) last = texts.join('\n');
  }
  return last;
}

// Whether a claim is contradicted by the repo facts. `commitsSinceStart` is
// null when the session recorded no starting HEAD (unknown), in which case a
// NOT-COMMITTED claim is judged on the clean tree alone.
export function contradicts(claim, porcelainCount, commitsSinceStart = null) {
  if (claim === 'not-committed') {
    return porcelainCount === 0 && (commitsSinceStart == null || commitsSinceStart > 0);
  }
  if (claim === 'committed') {
    return porcelainCount > 0;
  }
  return false;
}

// The paths from `git status --porcelain` that count as the user's own
// uncommitted work. The plugin's own folders are left out: `.claude/` holds the
// helpers' worktrees and `.orchestrator/` the run ledger, and both sit
// untracked in nearly every repo the plugin works in. Counting them made the
// check block a true sentence in the round-7 live run ("committed on branch
// X" while `.claude/` was the only untracked entry).
const OWN_FOLDERS = /^(?:"?)(?:\.claude|\.orchestrator)(?:\/|$)/;
export function countedPaths(paths) {
  return (Array.isArray(paths) ? paths : []).map(p => String(p || '').trim()).filter(p => p && !OWN_FOLDERS.test(p));
}
