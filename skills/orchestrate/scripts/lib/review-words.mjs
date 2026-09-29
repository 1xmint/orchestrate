// lib/review-words.mjs — which packets wait for independent review because of
// what their objective says, split out of guard-agent.mjs. No network, no
// child processes, no file access at all: pure text functions.

// Money, auth, destructive data, and shared-contract words. A packet whose
// OBJECTIVE mentions one of these waits for an independent review even when
// the packet never wrote REVIEW: yes — the same gate, reached a different way.
//
// A negation directly ahead of the word ("not auth", "no payment is
// involved") clears that match: reviewWordMatch below looks up to three
// words back for "not", "no", "never", "without", "non-", "excluding" or
// "other than" before counting a hit. Any other occurrence of the same word
// still matches ("touches payment; not auth" → "payment"), and the list
// itself stays eager: one unneeded review dispatched is cheap, one a real
// change should have gotten and silently skipped is not.
export const REVIEW_WORDS = [
  'payment', 'payments', 'billing', 'invoice', 'refund', 'checkout', 'stripe', 'price', 'pricing',
  'auth', 'authentication', 'authorization', 'login', 'password', 'credential', 'credentials', 'token', 'oauth', 'permission',
  'drop table', 'truncate', 'delete rows', 'delete records', 'purge', 'migration',
  'public api', 'schema others consume', 'contract',
];

// The OBJECTIVE section of a packet: everything between an OBJECTIVE heading
// (its own line, an optional trailing colon) and the next CONTEXT/SCOPE/DONE
// WHEN heading, or to the end of the prompt when none of those follow. A
// packet with no OBJECTIVE heading at all is judged on its whole text outside
// fenced code instead (see FENCED below).
// A packet's WHERE, FILES and RULES lines name paths, globs and constraints,
// not the work itself — "run dir <absolute path in the main checkout>" is
// the WHERE field's own template text, and a packet with no OBJECTIVE
// heading falls back to its first 600 characters (below), which often reach
// one of these lines. Stripped out before reviewWordMatch ever sees them, so
// a word like "checkout" sitting in a WHERE line does not read as the task's
// own objective.
const FIELD_LINE = /^[ \t]*(WHERE|FILES|RULES)[ \t]*:.*$/gim;

// A brief with no OBJECTIVE heading is read whole, minus fenced code: a brief
// that pastes a file first puts the ask well past any fixed cut (a real
// password-check brief did), while a word that only sits inside pasted code
// says nothing about the work.
const FENCED = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;

export function objectiveSection(prompt) {
  const text = String(prompt || '');
  const start = /^[ \t]*OBJECTIVE[ \t]*:?[ \t]*$/im.exec(text);
  const section = (() => {
    if (!start) return text.replace(FENCED, '');
    const rest = text.slice(start.index + start[0].length);
    const end = /^[ \t]*(CONTEXT|SCOPE|DONE WHEN)[ \t]*:?[ \t]*$/im.exec(rest);
    return end ? rest.slice(0, end.index) : rest;
  })();
  return section.replace(FIELD_LINE, '');
}

// A negation directly ahead of a candidate match clears it: up to three
// words back (not counting the match itself) for "not", "no", "never",
// "without", "non-", "excluding" or "other than".
const NEGATOR = /\b(not|no|never|without|non-?|excluding|other\s+than)\b/i;

function negatedBefore(text, index) {
  const before = text.slice(0, index);
  const words = before.trim().split(/\s+/).filter(Boolean).slice(-3);
  return NEGATOR.test(words.join(' '));
}

// The first REVIEW_WORDS entry (whole word or phrase, case-insensitive) found
// in an OBJECTIVE section with no negation directly ahead of it, or null. A
// small, pure function on purpose, kept apart from the regex-building above
// so both are testable on their own.
export function reviewWordMatch(section) {
  const text = String(section || '');
  for (const word of REVIEW_WORDS) {
    const pattern = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp(`\\b${pattern}\\b`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      if (!negatedBefore(text, m.index)) return word;
      if (m.index === re.lastIndex) re.lastIndex++; // guard against a zero-width match
    }
  }
  return null;
}

// What recordDispatch actually calls: the word (if any) that makes this
// packet's objective wait for independent review, regardless of whether the
// packet also wrote REVIEW: yes.
export function inferredReviewWord(prompt) {
  return reviewWordMatch(objectiveSection(prompt));
}
