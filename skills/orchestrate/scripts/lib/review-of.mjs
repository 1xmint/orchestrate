// The work a review is about, read the same way from the brief that sends a
// reviewer (guard-agent.mjs) and from the reviewer's hand-back (ledger.mjs), so
// the two ids compare equal. The id is the first token after "REVIEW OF:",
// stopping at a space, comma, semicolon or bracket, with trailing dots dropped.
const TOKEN = String.raw`REVIEW OF:[ \t]*([^\s,;()]+)`;
const OWN_LINE = new RegExp(String.raw`^\s*${TOKEN}`, 'im');
// The five-line hand-back puts it inside the OUTCOME line. Only a verdict line
// counts: a builder re-sent to fix a review quotes the brief's REVIEW OF on its
// own OUTCOME line, and reading that as a review would wave its fix through.
const ON_VERDICT = new RegExp(String.raw`^\s*OUTCOME:\s*(?:PASS|FAIL)\b[^\n]*?\b${TOKEN}`, 'm');

const clean = m => (m && m[1] ? m[1].replace(/\.+$/, '') : '') || null;

export function reviewOfIn(text, { handBack = false } = {}) {
  const t = String(text || '');
  return clean(OWN_LINE.exec(t)) || (handBack ? clean(ON_VERDICT.exec(t)) : null);
}
