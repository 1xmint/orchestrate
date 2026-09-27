// task-id.mjs — the one rule for "what is this packet's task id".
//
// A packet's TASK line can carry an actual id ("TASK: 9-27-0056") or, when a
// packet was written as prose instead of following the schema
// ("TASK: build the login page"), just its first word. Reading that first
// word as the id files the return under "build" and ends hold messages with
// "REVIEW OF: build" — silently wrong rather than loudly missing. The rule
// below is the fix used everywhere a packet's TASK line is read: the token
// after TASK: only counts as an id when it contains a digit, since every real
// task id in this project's scheme does (a date-based run number, a counter,
// or a short suffixed id like r6-3). A token with no digit is prose, and this
// returns null so callers fall back to their own "no id" behaviour instead of
// filing work under a stray word.
// `caseInsensitive` matches each call site's own regex flags: most match
// "TASK:" literally (guard-agent.mjs, workers.mjs), a couple already matched
// case-insensitively before this helper existed (ledger.mjs, report.mjs) and
// keep doing so here rather than silently tightening or loosening a check
// nobody asked to change.
export function taskIdIn(text, { caseInsensitive = false } = {}) {
  const re = caseInsensitive ? /^\s*TASK:\s*(\S+)/im : /^\s*TASK:\s*(\S+)/m;
  const id = (re.exec(String(text || '')) || [])[1];
  return id && /\d/.test(id) ? id : null;
}
