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

test('the card carries no counter phrase — those live behind `router status`', () => {
  assert.doesNotMatch(CARD, /orch-agents|codex:|tier \w|limits today/);
});
