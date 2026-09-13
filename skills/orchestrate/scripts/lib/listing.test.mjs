// listing.test.mjs — the fixed per-step load from installed plugins, read from
// the attachment records the host writes near the top of a transcript, and the
// plugin check said when the set is first seen or grows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseListing, pluginFitLine, pluginNames, readHead } from './listing.mjs';
import { pluginFitReport } from '../router.mjs';

const att = attachment => JSON.stringify({ type: 'attachment', attachment });
const skills = [
  '- brightdata-plugin:scrape: Scrape any page through Bright Data. Requires BRIGHTDATA_API_KEY and uses account credits for every request made.',
  '- brightdata-plugin:search',
  '- design:design-critique: Critique a design.',
  '- orchestrate:orchestrate: Run a goal end to end.',
  '- init',
].join('\n');

const transcriptWith = (skillText, extraTools = []) => [
  att({ type: 'deferred_tools_delta', addedNames: ['CronCreate', 'Monitor', ...extraTools], needsAuthMcpServers: ['plugin:bio-research:owkin', 'plugin:data:hex'], failedMcpServers: [{ name: 'plugin:data:definite' }] }),
  JSON.stringify({ type: 'user', message: { content: 'quoting "skill_listing" in a prompt is not a listing' } }),
  att({ type: 'mcp_instructions_delta', addedNames: ['chrome'], addedBlocks: ['## chrome\nuse it well'] }),
  att({ type: 'skill_listing', content: skillText, skillCount: skillText.split('\n').length, names: [] }),
].join('\n');
const transcript = transcriptWith(skills, ['mcp__plugin_bio-research_pubmed__search_articles']);

test('the listings are measured per plugin, from the host records only', () => {
  const l = parseListing(transcript);
  assert.equal(l.found, true);
  assert.equal(l.skills, 5);
  assert.equal(l.byPlugin['brightdata-plugin'].skills, 2);
  assert.equal(l.byPlugin['brightdata-plugin'].nameOnly, 1, 'a bare name has no description');
  assert.equal(l.byPlugin['brightdata-plugin'].paidHint, true);
  assert.equal(l.byPlugin.design.paidHint, false);
  assert.equal(l.byPlugin['(standalone)'].skills, 1);
  assert.equal(l.nameOnly, 2);
  assert.equal(l.byPlugin['bio-research'].tools, 1);
  assert.equal(l.byPlugin['bio-research'].signIn, true);
  assert.equal(l.byPlugin.data.failed, true);
  assert.equal(l.toolNames, 3);
  assert.equal(l.servers, 1);
  assert.equal(l.needsAuth, 2);
  assert.equal(l.failed, 1);
  assert.deepEqual(pluginNames(l), ['bio-research', 'brightdata-plugin', 'data', 'design', 'orchestrate']);
});

test('the first check lists every plugin with its facts and leaves the choice to the user', () => {
  const line = pluginFitLine(parseListing(transcript), { paidMode: 'never', profileScript: '/p/profile.mjs' });
  assert.match(line, /^every step re-reads ~\d+k tokens of listings/);
  assert.match(line, /2 skills arrived as a bare name/);
  assert.match(line, /brightdata-plugin 2 skills ~\d+t, 1 name-only, mentions a key, credits or billing/);
  assert.match(line, /bio-research 0 skills \+ 1 tools ~0t, waits for sign-in/);
  assert.match(line, /the user said never to use skills that bill an outside service/);
  assert.match(line, /Do not suggest installing plugins now/);
  assert.match(line, /node "\/p\/profile\.mjs" --set allowPaid=<plugin>/);
  assert.doesNotMatch(line, /\(standalone\)/, 'a standalone skill is not a plugin to remove');
  assert.equal(pluginFitLine(parseListing('nothing here')), '');
});

test('later checks name only added plugins, and a plugin allowed by name says so', () => {
  const l = parseListing(transcript);
  const line = pluginFitLine(l, { known: ['design', 'orchestrate', 'data', 'bio-research'], paidAllowed: ['brightdata-plugin'] });
  assert.match(line, /^new plugins since the last check: brightdata-plugin/);
  assert.match(line, /paid use allowed by the user/);
  assert.match(line, /allowed by name: brightdata-plugin/);
  assert.doesNotMatch(line, /design-critique|design \d/);
  assert.equal(pluginFitLine(l, { known: [...pluginNames(l), 'tavily'] }), '', 'a set that only shrank says nothing');
});

test('the router says the check once per plugin set, and again when plugins are added', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-fit-'));
  const stamp = join(dir, 'listing-report.json');
  const profilePath = join(dir, 'profile.json');
  writeFileSync(profilePath, JSON.stringify({ paidServices: 'never' }));
  const big = skills + '\n' + Array.from({ length: 400 }, (_, i) => `- bulk:skill-${i}: ${'x'.repeat(40)}`).join('\n');
  const t1 = join(dir, 't1.jsonl');
  writeFileSync(t1, transcriptWith(big));
  const first = pluginFitReport(t1, { path: stamp, profilePath });
  assert.match(first, /^every step re-reads/);
  assert.match(first, /never to use/);
  assert.equal(pluginFitReport(t1, { path: stamp, profilePath }), '', 'same set, said once');
  const t2 = join(dir, 't2.jsonl');
  writeFileSync(t2, transcriptWith(big + '\n- tavily:tavily-search: Search with Tavily credits.'));
  assert.match(pluginFitReport(t2, { path: stamp, profilePath }), /^new plugins since the last check: tavily/);
  assert.equal(pluginFitReport(t1, { path: stamp, profilePath }), '', 'removing one says nothing');
  assert.equal(pluginFitReport(join(dir, 'missing.jsonl'), { path: stamp, profilePath }), '');
});

test('a small setup gets no full check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-fit-'));
  const t = join(dir, 't.jsonl');
  writeFileSync(t, transcript);
  assert.equal(pluginFitReport(t, { path: join(dir, 's.json'), profilePath: join(dir, 'p.json') }), '');
});

test('only the head of a transcript is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-listing-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, transcript + '\n' + 'x'.repeat(2000));
  assert.equal(readHead(p, 50).length, 50);
  assert.equal(parseListing(readHead(p)).found, true);
  assert.equal(readHead(join(dir, 'missing.jsonl')), '');
});
