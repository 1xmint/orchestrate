// lib/proof-claim.mjs — does a test count in the closing message appear, as a
// test count, in any output the session was shown? Pure: persist-check.mjs
// supplies the closing message and the transcript tail, and states the fact.
//
// SKILL.md: "Copy each number, and each claim that a check ran, from a proof
// line ... Two closing messages carried figures that did not exist." A rule
// that a hook can hold should not live in prose alone (AGENTS.md), and a test
// count is the figure a non-engineer is most likely to trust without
// checking. So a count of passing tests in the closing message is looked for
// in what the session was shown and did not write: command output, a file it
// read, a helper's report, a notification, the user's own words.
//
// Kept narrow on both sides, because a wrong refusal costs the user a turn
// and a loose match proves nothing (independent review, rounds 6 to 8):
//   - a claim is a count of two digits or more next to a test word and a
//     pass word, in a sentence that is not a question or a condition, not
//     after "about" or "~", and not the total in "39 of 42";
//   - it is seen when the evidence has that number within a few words of a
//     test or pass word (a bare "42" in a SHA, a line number or a tool count
//     proves nothing), or when one output's passing figures add up to it.

const NUM = '(?<![\\w.,#~])(\\d{1,3}(?:,\\d{3})+|\\d{2,})';
// Not the total in "39 of 42" or "39/42" ("A total of 42 tests pass" is still
// a claim: no number comes before its "of").
const NOT_TOTAL = '(?<!\\d[\\d,]*\\s*(?:\\/|\\bof|\\bout\\s+of)\\s{0,3})';
// Not an estimate.
const NOT_ROUGH = '(?<!\\b(?:about|around|roughly|over|nearly|almost|approximately|some|at\\s+least|more\\s+than|fewer\\s+than|less\\s+than)\\s+)';
const ADJ = '(?:(?:new|existing|unit|integration|end-to-end|e2e|ci|api|ui|regression|smoke|remaining|other|added|updated)\\s+){0,2}';
const KIND = `${ADJ}(?:tests?|checks?|specs?|test\\s+cases?|assertions?|examples?)`;
const PASS = '(?:pass(?:ed|es|ing)?|are\\s+(?:passing|green)|green|succeed(?:ed)?)';
const CLAIM_RES = [
  // "42/42 tests pass", "42 of 42 tests passed", "42 out of 44 checks pass"
  new RegExp(`${NOT_ROUGH}${NUM}\\s*(?:\\/|of|out\\s+of)\\s*\\d[\\d,]*\\s+${KIND}\\s+(?:now\\s+|all\\s+)?${PASS}\\b`, 'gi'),
  // "all 42 tests pass", "42 new unit tests now pass"
  new RegExp(`${NOT_ROUGH}${NOT_TOTAL}${NUM}\\s+${KIND}\\s+(?:now\\s+|all\\s+|still\\s+)?${PASS}\\b`, 'gi'),
  // "Tests: 42 passed", "tests: 42/42 passed", "npm test: 120 passing"
  new RegExp(`\\b(?:tests?|checks?|specs?)\\b[^.\\n]{0,12}?${NOT_ROUGH}${NUM}(?:\\s*(?:\\/|of)\\s*\\d[\\d,]*)?\\s+(?:passing|passed)\\b`, 'gi'),
  // "42 passed, 0 failed": a bare count only beside a failed or skipped count
  new RegExp(`${NOT_ROUGH}${NOT_TOTAL}${NUM}\\s+(?:passing|passed)\\b(?=[^.\\n]{0,30}\\b\\d+\\s+(?:failed|failing|skipped|pending)\\b)`, 'gi'),
];
// A sentence that asks ("Do all 42 tests pass on your machine?") or sets a
// condition ("Once all 42 tests pass, I'll merge") claims nothing. A report
// heading that opens with an asking word ("What I checked: all 42 tests
// pass.") is a claim, as is a count followed by a question ("All 42 tests
// pass, so shall I open the PR?").
const ASKS = /^\W*(?:do|does|did|are|is|can|could|should|shall|will|would|has|have|what|which|how|why)\b[^]*\?\s*$/i;
const CONDITION = /^\W*(?:if|once|when|whenever|until|after|before|unless|as\s+soon\s+as)\b/i;

const plain = n => String(n).replace(/,/g, '');

// The counts the message claims pass, as plain digit strings, each once.
export function claimedCounts(text) {
  const out = new Set();
  for (const s of String(text || '').split(/(?<=[.!?])\s+|\n+/)) {
    if (ASKS.test(s) || CONDITION.test(s)) continue;
    for (const re of CLAIM_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) out.add(plain(m[1]));
    }
  }
  return [...out];
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : (b && b.content !== undefined) ? textOf(b.content) : '').join('\n')
  : '';

// A search result lists matching lines, so its figures are not one run's.
const LISTING_TOOLS = new Set(['Grep', 'Glob', 'WebSearch']);
// This hook's own refusal quotes the count it could not find.
const OWN_FEEDBACK = /^\s*Stop hook feedback:/;

// What the model was shown and did not write, one entry per piece:
// `{ text, sum }`, where `sum` marks a piece whose passing figures may be
// added up (anything but a search listing). Left out: the assistant's own
// words; the summary written at compaction and the host's meta records (both
// model-written or instructions); the host's own copy of a tool's input and
// output (`toolUseResult`), which for an edit holds the lead's new text; this
// hook's own feedback. A file read loses its line-number column. Thousands
// separators are taken out so "1,244" and "1244" agree.
export function evidenceParts(tail) {
  const parts = [];
  const toolOf = new Map();
  const norm = t => String(t).replace(/(\d),(?=\d{3}\b)/g, '$1');
  const add = (text, sum) => { if (text && !OWN_FEEDBACK.test(text)) parts.push({ text: norm(text), sum }); };
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec) continue;
    const msg = rec.message;
    if (rec.type === 'assistant') {
      for (const b of (msg && Array.isArray(msg.content) ? msg.content : [])) if (b && b.type === 'tool_use' && b.id) toolOf.set(b.id, b.name);
      continue;
    }
    if (rec.isCompactSummary || rec.isMeta) continue;
    if (msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b && b.type === 'tool_result') {
          const tool = toolOf.get(b.tool_use_id) || '';
          let t = textOf(b.content);
          if (tool === 'Read') t = t.replace(/^\s*\d+(?:\t|→)/gm, '');
          add(t, !LISTING_TOOLS.has(tool));
        } else if (b && typeof b.text === 'string') add(b.text, true);
      }
    } else if (msg && typeof msg.content === 'string') add(msg.content, true);
    const a = rec.attachment;
    if (a && typeof a.prompt === 'string') add(a.prompt, true);
    if (rec.type === 'system' && typeof rec.content === 'string') add(rec.content, true);
  }
  return parts;
}

export function evidenceText(tail) {
  return evidenceParts(tail).map(p => p.text).join('\n');
}

// The passing figures one output gives, so a total across suites printed in
// one run ("12 passed" and "30 passed") can be checked against "42".
function passSum(text) {
  let sum = 0;
  for (const m of String(text).matchAll(/(?<![\d.])(\d+)\s+(?:passed|passing)\b|\bpass(?:ed)?:?\s+(\d+)\b/gi)) sum += Number(m[1] || m[2]);
  return sum;
}

// A word near a number that makes it a test count rather than a line number,
// a SHA fragment or a tool count.
const NEAR = /\b(?:pass(?:ed|es|ing)?|ok|success(?:ful)?|green|tests?|specs?|checks?|examples?|assertions?|suites?)\b|✓|✔/i;

function seenAsCount(n, text) {
  const re = new RegExp(`(?<![\\w.])${n}(?![\\d]|\\.\\d)`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const near = text.slice(Math.max(0, m.index - 30), m.index + n.length + 30);
    if (NEAR.test(near)) return true;
  }
  return false;
}

// The claimed counts the evidence does not show as a test count, as plain digits.
export function unseenCounts(message, tail) {
  const claimed = claimedCounts(message);
  if (!claimed.length) return [];
  const parts = evidenceParts(tail);
  const sums = new Set(parts.filter(p => p.sum).map(p => passSum(p.text)).filter(Boolean).map(String));
  return claimed.filter(n => !sums.has(n) && !parts.some(p => seenAsCount(n, p.text)));
}
