// lib/proof-claim.mjs — does a test count in the closing message appear in any
// output the session has seen? Pure: persist-check.mjs supplies the closing
// message and the transcript tail, and states the fact.
//
// SKILL.md: "Copy each number, and each claim that a check ran, from a proof
// line ... Two closing messages carried figures that did not exist." A rule
// that a hook can hold should not live in prose alone (AGENTS.md), and a test
// count is the figure a non-engineer is most likely to trust without
// checking. So a count of passing tests in the closing message is looked for
// in what the session saw: command output, a helper's report, a notification,
// anything the user typed. The assistant's own words are not evidence.
//
// Kept narrow, because a wrong match costs the user a turn: only counts of
// tests or checks that pass, only numbers of two digits or more (a single
// digit is in every output and proves nothing), and the evidence is anything
// in the tail that is not the assistant's own text, so a figure read from a
// file, a CI page or a report counts.

// Not the end of a version or a decimal ("v2.0.10 passed" claims nothing).
const NUM = '(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+|\\d{2,})';
// Not the total after "of" or "/" ("39 of 42 tests pass" claims 39 pass).
const NOT_TOTAL = '(?<!(?:\\/|\\bof|\\bout\\s+of)\\s{0,3})';
const KIND = '(?:unit\\s+|integration\\s+|end-to-end\\s+|e2e\\s+)?(?:tests?|checks?|specs?|test\\s+cases?|assertions?)';
const PASS = '(?:pass(?:ed|es|ing)?|are\\s+(?:passing|green)|green|succeed(?:ed)?)';
const CLAIM_RES = [
  // "42/42 tests pass", "42 of 42 tests passed", "42 out of 44 checks pass"
  new RegExp(`${NUM}\\s*(?:\\/|of|out\\s+of)\\s*\\d[\\d,]*\\s+${KIND}\\s+(?:now\\s+|all\\s+)?${PASS}\\b`, 'gi'),
  // "all 42 tests pass", "42 unit tests now pass"
  new RegExp(`${NOT_TOTAL}${NUM}\\s+${KIND}\\s+(?:now\\s+|all\\s+|still\\s+)?${PASS}\\b`, 'gi'),
  // "42 passing", "42 passed, 0 failed", "tests: 42 passed"
  new RegExp(`${NOT_TOTAL}${NUM}\\s+(?:passing|passed)\\b`, 'gi'),
];

const plain = n => String(n).replace(/,/g, '');

// The counts the message claims pass, as plain digit strings, each once. A
// sentence that asks ("do all 42 tests pass on your machine?") claims nothing.
export function claimedCounts(text) {
  const out = new Set();
  for (const s of String(text || '').split(/(?<=[.!?])\s+|\n+/)) {
    if (/\?\s*$/.test(s)) continue;
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

// What the model was shown that it did not write: tool results as they reached
// it (commands, file reads, helpers' reports), the user's messages, and a
// message the host queued in (a helper's hand-back, a notification). Not the
// host's own copy of a tool's input and output (`toolUseResult`): for an edit
// that holds the lead's new text, so a figure it wrote into a file would prove
// itself (independent review, round 6). Thousands separators are taken out so
// "1,244" and "1244" agree. Returns one string per record.
export function evidenceParts(tail) {
  const parts = [];
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type === 'assistant') continue;
    const msg = rec.message;
    if (msg && msg.content !== undefined) parts.push(textOf(msg.content));
    const a = rec.attachment;
    if (a && typeof a.prompt === 'string') parts.push(a.prompt);
    if (rec.type === 'system' && typeof rec.content === 'string') parts.push(rec.content);
  }
  return parts.map(p => p.replace(/(\d),(?=\d{3}\b)/g, '$1'));
}

export function evidenceText(tail) {
  return evidenceParts(tail).join('\n');
}

// The passing figures one output gives, so a total across suites printed in
// one run ("12 passed" and "30 passed") can be checked against "42".
function passSum(text) {
  let sum = 0;
  for (const m of String(text).matchAll(/(?<![\d.])(\d+)\s+(?:passed|passing)\b|\bpass(?:ed)?:?\s+(\d+)\b/gi)) sum += Number(m[1] || m[2]);
  return sum;
}

// The claimed counts that appear nowhere in the evidence, as plain digits.
export function unseenCounts(message, tail) {
  const claimed = claimedCounts(message);
  if (!claimed.length) return [];
  const parts = evidenceParts(tail);
  const ev = parts.join('\n');
  const sums = new Set(parts.map(passSum).filter(Boolean).map(String));
  return claimed.filter(n => !sums.has(n) && !new RegExp(`(?<![\\d.])${n}(?![\\d]|\\.\\d)`).test(ev));
}
