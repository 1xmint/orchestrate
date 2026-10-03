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

test('the card weighs a helper by overall cost and carries the measured split cost', () => {
  // Live runs put the helper path at two to three times the lead's own cost on
  // a small app. The lead decides on overall cost, counting the cheaper model as
  // a saving (quota first); it no longer stops to ask, because how to build is
  // the lead's call (STATE.md, 0009 Stage 2).
  assert.match(CARD, /hand it over when that costs less overall: a cheaper model and reads kept out of your context, against the brief, the return you keep and checks\./);
  assert.match(CARD, /A small build split across helpers has cost two to three times doing it alone\./);
  assert.doesNotMatch(CARD, /let them pick/);
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
  assert.match(CARD, /Builders: orch-implementer on sonnet, own worktree \(worktree: yes\); finders: Explore on haiku, orch-researcher on sonnet\./);
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
  assert.match(CARD, /about eight tool calls;/);
  assert.match(CARD, /Use the helper or model the user names for a step\./);
  assert.match(CARD, /Buy independent review, even of your own work, for money, auth,/);
});

test('the card carries no counter phrase — those live behind `router status`', () => {
  assert.doesNotMatch(CARD, /orch-agents|codex:|tier \w|limits today/);
});

test('the card tells the lead to say "helper folder", never worktree, harness or a role name, to the user', () => {
  // Live runs: the lead said "worktree" to the user five times.
  assert.match(CARD, /Tell the user "helper folder", never worktree, harness or a role name\./);
});

test('the card makes who can see or change the user\'s data their call', () => {
  // The 0.18.0 release check: Claude built a no-password server any device on
  // the home wifi could open, said so, and asked only about the paid option.
  // "A public surface" did not read as covering the home wifi.
  assert.match(CARD, /Stop and ask only about what the product should do, money, who can see or change their data, credentials/);
  assert.doesNotMatch(CARD, /a public surface/);
});

test('the model the card names for each helper matches that helper\'s own definition', async () => {
  // The card said "orch-researcher on haiku" while the agent file and the
  // routing table said sonnet, and the guard holds a researcher at sonnet. A
  // lead that took the card at its word was steered one way by the card and
  // the other by the guard.
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const agents = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'agents');
  for (const m of CARD.matchAll(/(orch-[a-z]+) on (haiku|sonnet|opus|fable)/g)) {
    const def = readFileSync(join(agents, `${m[1]}.md`), 'utf8');
    const model = def.match(/^model:\s*(\S+)/m)?.[1];
    assert.equal(model, m[2], `the card says ${m[1]} on ${m[2]}; its definition says ${model}`);
  }
});

test('the card says not to test what can be known, and to stop at the same kind of failure twice', () => {
  // 0.20.1's session spent $10 on a test whose result was predictable from the
  // last one, and seven review rounds on cases of a kind the decisions ruled out.
  assert.match(CARD, /Proof of your change runs; an experiment you can predict, read or look up does not\./);
  assert.match(CARD, /The same kind of failure twice: stop and name what they share\./);
  assert.match(CARD, /show a test that failed before, look for the same mistake elsewhere\./);
});

test('the card carries decision 2c: a question back is not a decision, and a twice-unanswered question is settled by the lead', () => {
  // The record (plan 0010 step 2c): a reply that only asked back was written
  // down as the owner's decision, and the same product question went out three
  // times unchanged. Decided 2026-10-03: after "you decide" for the job, or a
  // product question twice unanswered with the work blocked, the lead takes its
  // own recommendation, records it as its pick and says so; one word reverses it.
  assert.match(CARD, /A reply that only asks back is not a decision\./);
  assert.match(CARD, /After "you decide" for this job, or a product question twice unanswered with the work blocked: take your recommendation, record it under Decisions as your pick, say so in one line\./);
});
