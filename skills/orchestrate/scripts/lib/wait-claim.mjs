// lib/wait-claim.mjs — does the closing message say this session will wait,
// watch or check back by itself, on something outside the conversation, while
// the Stop payload lists nothing out? Pure: persist-check.mjs supplies the
// message and the payload, and states the fact (docs/pause.md, "Waiting on
// nothing").
//
// The failure it is for: a turn that ends "I'll let you know when CI finishes"
// with nothing running. The host wakes a session for a helper, a background
// command, a Monitor or a scheduled prompt, which the Stop payload lists
// (background_tasks, session_crons: "Empty array when nothing is in flight",
// 2.1.288 type file). CI on GitHub or a deploy elsewhere is not among them, so
// the session sits until the user comes back to ask (the owner's record: about
// four hours on a check that never reported back, 0010 master plan, idea C).
//
// A wrong match costs the user a turn in any session, so it is narrow: only
// the last few sentences, only "I" (a "we'll watch the folder" in a feature
// description is not a promise), only a sentence that names something outside
// the conversation or a time, and never one that waits on the user.

// The session's own promise to wait, watch or come back.
const VERB_RES = [
  /\b(?:I'?ll|I\s+will|I'?m\s+going\s+to|let\s+me)\s+(?:now\s+|then\s+|also\s+)?(?:wait|keep\s+(?:an\s+eye|watching|checking|polling)|check\s+(?:back|again|in|on)|come\s+back|watch|monitor|poll|report\s+back|follow\s+up|circle\s+back|let\s+you\s+know|update\s+you|tell\s+you|ping\s+you)\b/i,
  /\b(?:I'?m|I\s+am)\s+(?:now\s+|still\s+)?(?:waiting|watching|monitoring|polling|standing\s+by)\b/i,
  /^(?:now\s+|still\s+)?(?:waiting\s+(?:for|on|until)|watching|monitoring|standing\s+by|will\s+(?:check\s+back|report\s+back|follow\s+up|let\s+you\s+know))\b/i,
];

// Something outside the conversation that finishes by itself, or a time.
const OUTSIDE_RE = /\b(?:CI|GitHub\s+Actions|checks?|builds?|deploy(?:s|ment)?|jobs?|runs?|workflows?|pipelines?|tests?|test\s+suite|release|migration|upload|download|install(?:ation)?|rollout|results?)\b|\bwhen\s+(?:it|that|this)\s+(?:finishes|completes|is\s+done|lands|passes|fails|is\s+green|is\s+ready)\b/i;
const TIME_RE = /\bin\s+(?:(?:a\s+few|a\s+couple(?:\s+of)?|\d+|one|two|three|five|ten|fifteen|twenty|thirty)\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)|an\s+hour|a\s+minute|a\s+bit|a\s+while|a\s+moment)\b|\bshortly\b|\blater\b|\bperiodically\b|\bevery\s+(?:\d+|few|couple)\b/i;

// A sentence that hands the next move to the user waits on them, and their
// reply wakes the session.
const ON_USER_RE = /\b(?:let\s+me\s+know|tell\s+me|once\s+you|when\s+you|after\s+you|if\s+you|until\s+you|wait(?:ing)?\s+(?:for|on)\s+(?:you|your)\b|your\s+(?:reply|answer|go-ahead|approval|confirmation|decision|input|call)|further\s+instructions)\b/i;

// A message that says it set up its own wake-up (a reminder sent into this
// conversation is not in the payload's lists).
const SELF_WAKE_RE = /\b(?:scheduled|set\s+(?:up\s+)?an?\s+(?:reminder|wake-?up|timer)|reminder)\b/i;

const LAST_SENTENCES = 3;

// True when one of the message's last sentences promises that this session
// will wait, watch or come back for something outside the conversation.
export function claimsWait(text) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim()).filter(Boolean)
    .slice(-LAST_SENTENCES);
  if (sentences.some(s => SELF_WAKE_RE.test(s))) return false;
  return sentences.some(s => !ON_USER_RE.test(s) && VERB_RES.some(re => re.test(s)) && (OUTSIDE_RE.test(s) || TIME_RE.test(s)));
}

// True only when the payload says, in both lists, that nothing is out. A field
// that is absent is unknown (an older host), never "nothing".
export function nothingOut(input) {
  return Boolean(input)
    && Array.isArray(input.background_tasks) && input.background_tasks.length === 0
    && Array.isArray(input.session_crons) && input.session_crons.length === 0;
}

// A tool this turn called that may wake the session from outside what the
// payload lists (a reminder sent into this conversation, a scheduled task).
export const SCHEDULING_TOOL = /send_later|schedule|wakeup|cron|trigger|remind/i;

// The fact, as the payload shows it; what to do about it is the lead's call.
export const WAIT_FACT = 'the Stop payload lists no helper, background command, Monitor or scheduled prompt that would wake this session';
