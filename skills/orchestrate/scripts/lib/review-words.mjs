// lib/review-words.mjs — which packets wait for independent review because of
// what their objective says, split out of guard-agent.mjs. No network, no
// child processes, no file access at all: pure text functions.

// Money, auth, destructive data, and shared-contract words. A packet whose
// OBJECTIVE mentions one of these waits for an independent review even when
// the packet never wrote REVIEW: yes — the same gate, reached a different way.
//
// A negation in the objective text ("not auth", "no payment") still matches:
// this is a plain substring/word check with no sense of negation, on purpose.
// One unneeded review dispatched is cheap; one review a real change should
// have gotten and silently skipped is not, so this list is deliberately eager.
export const REVIEW_WORDS = [
  'payment', 'payments', 'billing', 'invoice', 'refund', 'checkout', 'stripe', 'price', 'pricing',
  'auth', 'authentication', 'authorization', 'login', 'password', 'credential', 'credentials', 'token', 'oauth', 'permission',
  'drop table', 'truncate', 'delete rows', 'delete records', 'purge', 'migration',
  'public api', 'schema others consume', 'contract',
];

// The OBJECTIVE section of a packet: everything between an OBJECTIVE heading
// (its own line, an optional trailing colon) and the next CONTEXT/SCOPE/DONE
// WHEN heading, or to the end of the prompt when none of those follow. A
// packet with no OBJECTIVE heading at all is judged on its first 600
// characters instead, since that is usually where the ask is stated.
export function objectiveSection(prompt) {
  const text = String(prompt || '');
  const start = /^[ \t]*OBJECTIVE[ \t]*:?[ \t]*$/im.exec(text);
  if (!start) return text.slice(0, 600);
  const rest = text.slice(start.index + start[0].length);
  const end = /^[ \t]*(CONTEXT|SCOPE|DONE WHEN)[ \t]*:?[ \t]*$/im.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

// The first REVIEW_WORDS entry (whole word or phrase, case-insensitive) found
// in an OBJECTIVE section, or null. A small, pure function on purpose, kept
// apart from the regex-building above so both are testable on their own.
export function reviewWordMatch(section) {
  const text = String(section || '');
  for (const word of REVIEW_WORDS) {
    const pattern = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    if (new RegExp(`\\b${pattern}\\b`, 'i').test(text)) return word;
  }
  return null;
}

// What recordDispatch actually calls: the word (if any) that makes this
// packet's objective wait for independent review, regardless of whether the
// packet also wrote REVIEW: yes.
export function inferredReviewWord(prompt) {
  return reviewWordMatch(objectiveSection(prompt));
}
