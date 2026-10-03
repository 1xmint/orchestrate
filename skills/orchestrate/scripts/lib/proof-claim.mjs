// lib/proof-claim.mjs — does a test count in the closing message appear in any
// output the session was shown? Pure: persist-check.mjs supplies the closing
// message and the transcript tail, and states the fact.
//
// SKILL.md: "Copy each number, and each claim that a check ran, from a proof
// line ... Two closing messages carried figures that did not exist." A rule
// that a hook can hold should not live in prose alone (AGENTS.md), and a test
// count is the figure a non-engineer is most likely to trust without
// checking. So a count of passing tests in the closing message is looked for
// in what the session was shown and did not write: command output, a file it
// read, a helper's report, a notification, the user's own words.
//
// Kept narrow, because a wrong match costs the user a turn: only counts of
// tests or checks that pass, only numbers of two digits or more (a single
// digit is in every output and proves nothing), never a sentence that asks,
// and never the total after "N of".

// Not the end of a version or a decimal ("v2.0.10 passed" claims nothing).
const NUM = '(?<![\\d.,])(\\d{1,3}(?:,\\d{3})+|\\d{2,})';
// Not the total in "39 of 42" or "39/42" ("A total of 42 tests pass" is still
// a claim: no number comes before its "of").
const NOT_TOTAL = '(?<!\\d[\\d,]*\\s*(?:\\/|\\bof|\\bout\\s+of)\\s{0,3})';
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
// A sentence that opens by asking ("Do all 42 tests pass on your machine?")
// claims nothing; one that states a count and then asks ("All 42 tests pass,
// so shall I open the PR?") still does.
const ASKS = /^\W*(?:do|does|did|are|is|can|could|should|shall|will|would|has|have|what|which|how|why)\b/i;

const plain = n => String(n).replace(/,/g, '');

// The counts the message claims pass, as plain digit strings, each once.
export function claimedCounts(text) {
  const out = new Set();
  for (const s of String(text || '').split(/(?<=[.!?])\s+|\n+/)) {
    if (ASKS.test(s)) continue;
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

// Tools whose result is a command's own output, the only place a run's
// passing figures may be added up.
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor', 'BashOutput', 'TaskOutput']);

// What the model was shown and did not write, one entry per piece:
// `{ text, run }`, where `run` marks a command's output or a notification.
// Left out: the assistant's own words; the summary written at compaction and
// the host's meta records (both model-written or instructions); the host's own
// copy of a tool's input and output (`toolUseResult`), which for an edit holds
// the lead's new text (independent review, rounds 6 and 7). A file read loses
// its line-number column, which would otherwise match almost any count.
// Thousands separators are taken out so "1,244" and "1244" agree.
export function evidenceParts(tail) {
  const parts = [];
  const toolOf = new Map();
  const norm = t => String(t).replace(/(\d),(?=\d{3}\b)/g, '$1');
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
          parts.push({ text: norm(t), run: COMMAND_TOOLS.has(tool) });
        } else if (b && typeof b.text === 'string') parts.push({ text: norm(b.text), run: false });
      }
    } else if (msg && typeof msg.content === 'string') parts.push({ text: norm(msg.content), run: /<task-notification>/.test(msg.content) });
    const a = rec.attachment;
    if (a && typeof a.prompt === 'string') parts.push({ text: norm(a.prompt), run: true });
    if (rec.type === 'system' && typeof rec.content === 'string') parts.push({ text: norm(rec.content), run: true });
  }
  return parts;
}

export function evidenceText(tail) {
  return evidenceParts(tail).map(p => p.text).join('\n');
}

// The passing figures one run's output gives, so a total across suites
// printed in one run ("12 passed" and "30 passed") can be checked against
// "42". Only a command's output or a notification is added up: a search
// result that lists one summary line five times is not a run of five suites.
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
  const ev = parts.map(p => p.text).join('\n');
  const sums = new Set(parts.filter(p => p.run).map(p => passSum(p.text)).filter(Boolean).map(String));
  return claimed.filter(n => !sums.has(n) && !new RegExp(`(?<![\\d.])${n}(?![\\d]|\\.\\d)`).test(ev));
}
