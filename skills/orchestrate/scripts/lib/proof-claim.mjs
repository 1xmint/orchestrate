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

const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d{2,})';
const KIND = '(?:unit\\s+|integration\\s+|end-to-end\\s+|e2e\\s+)?(?:tests?|checks?|specs?|test\\s+cases?|assertions?)';
const PASS = '(?:pass(?:ed|es|ing)?|are\\s+(?:passing|green)|green|succeed(?:ed)?)';
const CLAIM_RES = [
  // "42/42 tests pass", "42 of 42 tests passed", "42 out of 44 checks pass"
  new RegExp(`\\b${NUM}\\s*(?:\\/|of|out\\s+of)\\s*\\d[\\d,]*\\s+${KIND}\\s+(?:now\\s+|all\\s+)?${PASS}\\b`, 'gi'),
  // "all 42 tests pass", "42 unit tests now pass"
  new RegExp(`\\b${NUM}\\s+${KIND}\\s+(?:now\\s+|all\\s+|still\\s+)?${PASS}\\b`, 'gi'),
  // "42 passing", "42 passed, 0 failed", "tests: 42 passed"
  new RegExp(`\\b${NUM}\\s+(?:passing|passed)\\b`, 'gi'),
];

const plain = n => String(n).replace(/,/g, '');

// The counts the message claims pass, as plain digit strings, each once.
export function claimedCounts(text) {
  const s = String(text || '');
  const out = new Set();
  for (const re of CLAIM_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) out.add(plain(m[1]));
  }
  return [...out];
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => (b && typeof b.text === 'string') ? b.text : (b && b.content !== undefined) ? textOf(b.content) : '').join('\n')
  : '';

// Everything in the tail that is not the assistant's own text: tool results
// (commands, file reads, helpers' reports), notifications and the user's own
// words, with thousands separators taken out so "1,244" and "1244" agree.
export function evidenceText(tail) {
  const parts = [];
  for (const line of String(tail || '').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.type === 'assistant') continue;
    const msg = rec.message;
    if (msg && msg.content !== undefined) parts.push(textOf(msg.content));
    if (rec.toolUseResult !== undefined) parts.push(typeof rec.toolUseResult === 'string' ? rec.toolUseResult : JSON.stringify(rec.toolUseResult));
    if (rec.attachment !== undefined) parts.push(JSON.stringify(rec.attachment));
  }
  return parts.join('\n').replace(/(\d),(?=\d{3}\b)/g, '$1');
}

// The claimed counts that appear nowhere in the evidence, as plain digits.
export function unseenCounts(message, tail) {
  const claimed = claimedCounts(message);
  if (!claimed.length) return [];
  const ev = evidenceText(tail);
  return claimed.filter(n => !new RegExp(`(?<![\\d.])${n}(?![\\d]|\\.\\d)`).test(ev));
}
