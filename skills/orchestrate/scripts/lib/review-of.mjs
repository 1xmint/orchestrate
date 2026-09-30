// The work a review is about, read the same way from the brief that sends a
// reviewer (guard-agent.mjs) and from the reviewer's hand-back (ledger.mjs), so
// the two ids compare equal. The id is the first token after "REVIEW OF:",
// stopping at a space, comma, semicolon or bracket, with trailing dots dropped.
const TOKEN = String.raw`REVIEW OF:[ \t]*([^\s,;()]+)`;
const OWN_LINE = new RegExp(String.raw`^\s*${TOKEN}`, 'im');
const IN_LINE = new RegExp(String.raw`\b${TOKEN}`);
const OUTCOME_LINE = /^\s*OUTCOME\s*[:\-–—]/im;
const VERDICT_OUTCOME = /^\s*OUTCOME\s*[:\-–—]\s*(?:PASS|FAIL)\b/i;
const VERDICT_LINE = /^\s*VERDICT:\s*(?:PASS|FAIL)\b/im;

const clean = m => (m && m[1] ? m[1].replace(/\.+$/, '') : '') || null;

// A hand-back names reviewed work only when it is itself a verdict, because a
// builder re-sent to fix a review quotes that review, and reading the quote as
// a review would file the fix as reviewed. The five-line form must open with
// "OUTCOME: PASS|FAIL (REVIEW OF: <id>)" and only that line is read, so a quote
// further down, or the report's own REVIEW OF line, never decides. The older
// form, with no OUTCOME line, counts only beside a "VERDICT: PASS|FAIL" line.
function handBackReviewOf(t) {
  if (OUTCOME_LINE.test(t)) {
    const first = (t.split('\n').find(l => l.trim()) || '');
    return VERDICT_OUTCOME.test(first) ? clean(IN_LINE.exec(first)) : null;
  }
  return VERDICT_LINE.test(t) ? clean(OWN_LINE.exec(t)) : null;
}

export function reviewOfIn(text, { handBack = false } = {}) {
  const t = String(text || '');
  return handBack ? handBackReviewOf(t) : clean(OWN_LINE.exec(t));
}
