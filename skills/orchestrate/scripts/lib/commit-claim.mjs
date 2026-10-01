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
  'left uncommitted',
];

// "did not <verb list> commit", e.g. "did not touch, add, or commit
// notes.txt" — a list of verbs between the negation and "commit" is still a
// not-committed claim, not just the bare "did not commit" wording (round-9
// audit finding 2: the literal-phrase list missed this and let a true
// sentence get blocked).
const NEG_STEM = "(?:did\\s+not|didn't|have\\s+not|haven't|has\\s+not|hasn't)";
const CLAIM_VERB = '(?:touch|add|stage|change|commit)';
const notCommittedListRe = new RegExp(
  `${NEG_STEM}\\s+(?:${CLAIM_VERB}\\s*,?\\s*)*(?:or\\s+)?commit\\b`,
  'gi',
);

const notCommittedRe = new RegExp(
  NOT_COMMITTED_PHRASES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')
    + `|${notCommittedListRe.source}`,
  'gi',
);

// "no uncommitted files" says the opposite of "uncommitted": everything is
// committed. Only a negation right before the word (one "any" allowed between)
// turns it round; "No files changed, but notes.txt is uncommitted" stays a
// not-committed claim.
const negatedUncommittedRe = /\b(?:no|nothing|none|zero|without)\s+(?:any\s+)?uncommitted\b/gi;

const committedWordRe = /\bcommitted\b/i;
// Words that make a sentence about "committed" something other than a report
// that it happened: time and condition (before, until, once, if, unless, after,
// when, whether), negation (not, no, nothing, never, n't), and what has not
// happened yet (will, would, should, can, could, may, might, to be, going to).
const NOT_A_CLAIM_RE = /\b(?:before|until|till|once|if|unless|after|when|whenever|whether|not|no|nothing|none|never|without|will|would|should|shall|can|could|may|might|must|need|needs|to\s+be|going\s+to|about\s+to|ready\s+to|want|wants|please)\b|n't\b/i;
const commitsAreInRe = /\bcommits\s+are\s+in\b/i;

// One sentence's claim: 'not' | 'committed' | 'mixed' | null. The negation
// phrase is stripped out before the bare "committed" check, because every
// NOT_COMMITTED phrase except "uncommitted" and the two "commit" ones
// contains the word "committed" itself ("have not committed") — without the
// strip, every not-committed claim would misread as also claiming committed.
function classifySentence(raw) {
  const sentence = raw.replace(negatedUncommittedRe, ' committed ');
  const matched = sentence.match(notCommittedRe);
  const hasNot = !!matched;
  const stripped = hasNot ? sentence.replace(notCommittedRe, ' ') : sentence;
  const hasCommitted = committedWordRe.test(stripped) || commitsAreInRe.test(stripped);
  // "bring it back for approval before anything is committed" says the opposite
  // of a claim. Only a plain statement that the work IS committed counts; a
  // negated, future, conditional or "before/until/once/if" sentence is not one,
  // and when unsure nothing is said.
  if (hasCommitted && !hasNot && NOT_A_CLAIM_RE.test(stripped)) return null;
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

// Whether the message already names every path `countedPaths` lists, by
// basename — a message that spells out each uncommitted file (e.g. "notes.txt
// is the user's own untracked file") is consistent with the status it
// describes, whatever claim it also makes, and should not be blocked (round-9
// audit finding 2, live run 1: the lead's summary had already named
// `notes.txt` and was blocked anyway).
export function namesAllPaths(text, paths) {
  const list = Array.isArray(paths) ? paths : [];
  if (!list.length) return false;
  const t = String(text || '').toLowerCase();
  return list.every(p => {
    const clean = String(p || '').trim().replace(/^"|"$/g, '');
    // `git status --porcelain` reports an untracked directory as the
    // directory path itself, ending in "/" — it never names the files inside.
    // A message naming a path under that directory (e.g. "src/notes.txt" for
    // status entry "src/") describes the same untracked content and should
    // count, so this is satisfied by any named path that starts with it,
    // not by the directory's own (empty) basename.
    if (clean.endsWith('/')) return t.includes(clean.toLowerCase());
    const base = clean.split(/[\\/]/).pop();
    return !!base && t.includes(base.toLowerCase());
  });
}
