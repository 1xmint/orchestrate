// lib/wait-claim.mjs — does the closing message say this session will wait,
// watch or check back by itself, while the Stop payload says nothing is out
// that could wake it? Pure: persist-check.mjs supplies the message and the
// payload, and states the fact (docs/pause.md, "Waiting on nothing").
//
// The failure it is for: a turn that ends "I'll let you know when CI finishes"
// with nothing running. The host wakes a session for a helper, a background
// command, a Monitor or a scheduled prompt, which the Stop payload lists
// (background_tasks, session_crons: "Empty array when nothing is in flight",
// 2.1.288 type file). CI on GitHub, a deploy elsewhere or "a few minutes" wake
// nothing, so the session sits until the user comes back to ask (the owner's
// record: about four hours on a check that never reported back, 0010 master
// plan, idea C).

// The session's own promise to wait, watch or come back, in the first person.
// "You can wait for CI" and "once CI passes, merge it" say what the user may
// do, not what this session will, so they are not claims.
const WAIT_RES = [
  /\b(?:I'?ll|I\s+will|I'?m\s+going\s+to|let\s+me|we'?ll|we\s+will)\s+(?:now\s+|then\s+)?(?:wait|keep\s+(?:an\s+eye|watching|checking|polling)|check\s+(?:back|again|in)|come\s+back|watch|monitor|poll)\b/gi,
  /\b(?:I'?m|I\s+am|we'?re|we\s+are)\s+(?:now\s+|still\s+)?(?:waiting|watching|monitoring|polling)\b/gi,
  /(?:^|[.!:;]\s+|\n\s*(?:[-*]\s+)?)(?:now\s+|still\s+)?(?:waiting\s+(?:for|on|until)|(?:watching|monitoring)\s+(?:for|on|until|the|a|it|CI)\b)/gi,
  /\b(?:I'?ll|I\s+will|we'?ll|we\s+will)\s+(?:report\s+back|update\s+you|let\s+you\s+know|tell\s+you|ping\s+you)\b[^.!?\n]{0,60}?\b(?:when|once|as\s+soon\s+as|after)\b/gi,
];

// What follows the words: the user's own reply wakes the session, so waiting
// on them is not a wait on nothing.
const ON_USER_RE = /^[\s,:-]*(?:(?:for|on|until|to\s+hear\s+from)\s+)?(?:you\b|your\b|the\s+user\b|a\s+reply\b|an?\s+answer\b|approval\b|confirmation\b|the\s+go-ahead\b|a\s+decision\b|input\b)/i;

// True when the message promises that this session will wait or come back
// for something other than the user's own reply.
export function claimsWait(text) {
  const s = String(text || '');
  for (const re of WAIT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (!ON_USER_RE.test(s.slice(m.index + m[0].length, m.index + m[0].length + 40))) return true;
    }
  }
  return false;
}

// True only when the payload says, in both lists, that nothing is out. A field
// that is absent is unknown (an older host), never "nothing".
export function nothingOut(input) {
  return Boolean(input)
    && Array.isArray(input.background_tasks) && input.background_tasks.length === 0
    && Array.isArray(input.session_crons) && input.session_crons.length === 0;
}

// The fact, stated once; what to do about it is the lead's call.
export const WAIT_FACT = 'nothing is out that would wake this session: no helper, background command, Monitor or scheduled prompt is running, so it stays idle until the user writes';
