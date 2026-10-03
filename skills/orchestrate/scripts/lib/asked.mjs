// lib/asked.mjs — a question the lead put to the user that keeps coming back
// unanswered. The router counts it at each prompt, because the prompt is the
// one place that sees the reply, and says the count from the second time.
//
// Why: in the record the same product question went to the owner three times
// unchanged while he typed "continue" (docs/research/0010-master-plan.md, step
// 2c). The card's rule (decision 2c, 2026-10-03) is that a product question
// twice unanswered with the work blocked is settled by the lead's own
// recommendation, recorded as its pick. A count is exactly what a summary of a
// long conversation drops, so the hook states it; what to do stays in the card.
//
// Everything here is pure. "Unchanged" means the same words after case, spacing,
// punctuation and numbers are set aside; a reworded question starts again.

// The question that closes a message, or null when the message does not end on
// one. Trailing markdown is set aside the way persist-check.mjs reads "asked".
export function lastQuestion(text) {
  const t = String(text || '').trim().replace(/[\s*_`)\]]+$/, '');
  if (!t.endsWith('?')) return null;
  const parts = t.split(/\n+|(?<=[.!:])\s+/).map(s => s.trim()).filter(Boolean);
  // Markdown that opens the sentence ("**Do you want…?**") is not its words.
  const q = (parts.length ? parts[parts.length - 1] : t).replace(/^[\s*_`>#-]+/, '');
  return q.length > 300 ? q.slice(-300) : q;
}

export function questionKey(q) {
  return String(q || '').toLowerCase().replace(/\d+/g, '#').replace(/[^a-z# ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// Handing the choice back is an answer: it settles the question. Said as a
// question ("what would you pick?") it is asking back, so it leaves it open.
const DELEGATE = /\b(you decide|your call|up to you|you pick|you choose|whatever you think|your choice)\b/i;

// Whether a reply leaves the question open: a nudge to carry on ("continue",
// "try again", "whats left", "keep going until it's done"; the router passes
// `nudge` from its own reading of those words), or a reply that only asks back.
// A plain "yes" or "ok" is an answer to a yes-or-no question, so it is not here.
export function leavesOpen(reply, { nudge = false } = {}) {
  const r = String(reply || '').trim();
  if (!r) return true;
  const asksBack = /\?\s*$/.test(r);
  if (DELEGATE.test(r) && !asksBack) return false;
  if (nudge) return true;
  return asksBack;
}

// The next record from the last one. `question` is lastQuestion of the lead's
// last message (null when it asked nothing). Returns null when nothing is open.
// The replies are kept (short, the last three), so the fact can say what they
// were rather than judge them.
export function nextAsked(prev, { question, reply, nudge = false }) {
  if (!question || !leavesOpen(reply, { nudge })) return null;
  const key = questionKey(question);
  if (!key) return null;
  const same = prev && prev.key === key;
  const said = String(reply || '').replace(/\s+/g, ' ').trim();
  const short = said.length > 40 ? `${said.slice(0, 37)}...` : said;
  return {
    key,
    times: same ? (Number(prev.times) || 0) + 1 : 1,
    question,
    replies: [...(same && Array.isArray(prev.replies) ? prev.replies : []), short].slice(-3),
  };
}

// The fact, from the second time on; '' before that.
export function askedLine(rec) {
  if (!rec || rec.times < 2) return '';
  const q = rec.question.length > 160 ? `${rec.question.slice(0, 157)}...` : rec.question;
  const replies = (rec.replies || []).map(r => r ? `"${r}"` : 'nothing').join(', ');
  return `[orchestrate · question] This question has gone out ${rec.times} times unchanged; the replies were ${replies}: "${q}"`;
}
