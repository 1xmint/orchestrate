// lib/card.test.mjs — the fixed card text and its cap, tested directly rather
// than through a spawned router process (router.test.mjs keeps those).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD, CARD_CAP, cardBody, SHORT_CARD_CAP, shortCard } from './card.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('lib/card.mjs exports exactly the eight names this concern owns', async () => {
  const mod = await import('./card.mjs');
  assert.deepEqual(Object.keys(mod).sort(), ['CARD', 'CARD_CAP', 'SHORT_CARD_CAP', 'autocompactOffNote', 'autocompactTip', 'cardBody', 'compactNote', 'shortCard'].sort());
});

test('the short card stays inside its own, much smaller cap', () => {
  const body = shortCard();
  assert.ok(body.length <= SHORT_CARD_CAP, `short card is ${body.length} characters, cap ${SHORT_CARD_CAP}`);
  assert.doesNotMatch(body, /CARD|cardSent|cardBody/, 'no machinery names leak into the short card');
});

test('the card body stays inside the cap it names, and has one home in code', () => {
  // Every character is paid on every later turn of the session that got it.
  const body = cardBody();
  assert.equal(body, CARD, 'cardBody is CARD, with no other source to drift from');
  assert.ok(body.length <= CARD_CAP, `card is ${body.length} characters, cap ${CARD_CAP}`);
  assert.match(body, /router off/, 'it says how to turn itself off');
  assert.ok(!existsSync(join(HERE, '..', '..', 'references', 'ladder.md')), 'ladder.md is gone; the card text has one home now');
});

test('the card has the user pick before a small build is split across helpers', () => {
  // Live runs put the helper path at two to three times the lead's own cost on
  // a small app, and the user had never been shown the pair before it was chosen.
  assert.match(CARD, /Before splitting a small build across helpers, tell the user it has cost about two to three times doing it alone, and let them pick\./);
});

test('the card points at the project page\'s Next as the plan, and no longer asks for three plain lines', () => {
  // The card is re-shown, so it must not contradict SKILL.md.
  assert.match(CARD, /The plan the user sees is Next in \.orchestrator\/PROJECT\.md; keep it current\./);
  assert.doesNotMatch(CARD, /three plain lines/);
});

test('the card names the helper kinds, and its builder advice clears the guard on the first try', async () => {
  // A live lead sent general-purpose three times, then orch-implementer three
  // times with "notes.json in the project root" in the packet (read by the
  // guard as "work in the shared checkout"); only the seventh call passed.
  const { workflowDecision } = await import('./workflow.mjs');
  const { loadPolicy } = await import('./policy.mjs');
  assert.match(CARD, /Builders: orch-implementer on sonnet, own worktree \(worktree: yes\); finders: Explore or orch-researcher on haiku\./);
  const packet = 'Build lib/add.js; notes are kept in notes.json in the project root.';
  const ti = p => ({ subagent_type: 'orch-implementer', model: 'sonnet', prompt: p });
  const opts = { policy: loadPolicy(null), installed: 8, missing: [] };
  assert.equal(workflowDecision({}, ti(packet), opts), null, 'where a file lives is not an order to work in the shared checkout');
  assert.ok(workflowDecision({}, ti(`Work directly in the project root. ${packet}`), opts), 'a brief that says to work in the shared checkout is still refused');
  assert.equal(workflowDecision({}, ti(`WHERE: worktree: yes\n${packet}`), opts), null, 'with them it passes');
});

test('the card keeps risky work and a request for a helper out of the do-it-yourself rule', () => {
  // A live lead built a password check on a payments page alone, with no
  // second look, though the user had asked for a helper and for safety.
  assert.match(CARD, /about eight small tool calls and the user asked for no helper;/);
  assert.match(CARD, /Buy independent review, even of your own work, for money, auth,/);
});

test('the card carries no counter phrase — those live behind `router status`', () => {
  assert.doesNotMatch(CARD, /orch-agents|codex:|tier \w|limits today/);
});

test('the card tells the lead to say "helper folder", never worktree, harness or a role name, to the user', () => {
  // Live runs: the lead said "worktree" to the user five times.
  assert.match(CARD, /Tell the user "helper folder", never worktree, harness or a role name\./);
});
