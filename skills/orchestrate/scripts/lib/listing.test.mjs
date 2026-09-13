// listing.test.mjs — the fixed per-step load from installed plugins, read from
// the attachment records the host writes near the top of a transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseListing, listingLine, readHead } from './listing.mjs';

const att = attachment => JSON.stringify({ type: 'attachment', attachment });
const skills = [
  '- brightdata-plugin:scrape: Scrape any page through Bright Data. Requires BRIGHTDATA_API_KEY and uses account credits for every request made.',
  '- brightdata-plugin:search: Search the web through Bright Data.',
  '- design:design-critique: Critique a design.',
  '- orchestrate:orchestrate: Run a goal end to end.',
  '- init',
].join('\n');

const transcript = [
  att({ type: 'deferred_tools_delta', addedNames: ['CronCreate', 'Monitor'], addedLines: ['CronCreate', 'Monitor'], needsAuthMcpServers: ['plugin:a:b', 'plugin:c:d'], failedMcpServers: [{ name: 'x' }] }),
  JSON.stringify({ type: 'user', message: { content: 'quoting "skill_listing" in a prompt is not a listing' } }),
  att({ type: 'mcp_instructions_delta', addedNames: ['chrome'], addedBlocks: ['## chrome\nuse it well'] }),
  att({ type: 'skill_listing', content: skills, skillCount: 5, names: [] }),
].join('\n');

test('the listings are measured per plugin, from the host records only', () => {
  const l = parseListing(transcript);
  assert.equal(l.found, true);
  assert.equal(l.skills, 5);
  assert.equal(l.byPlugin['brightdata-plugin'].skills, 2);
  assert.equal(l.byPlugin.design.skills, 1);
  assert.equal(l.byPlugin['(standalone)'].skills, 1);
  assert.equal(l.toolNames, 2);
  assert.equal(l.servers, 1);
  assert.equal(l.needsAuth, 2);
  assert.equal(l.failed, 1);
});

test('the line names the largest plugins and leaves the choice to the user', () => {
  const line = listingLine(parseListing(transcript));
  assert.match(line, /^every step re-reads ~\d+k tokens of listings/);
  assert.match(line, /Largest: brightdata-plugin 2 skills/);
  assert.match(line, /2 tool servers are waiting for sign-in and 1 failed/);
  assert.match(line, /turning a plugin off/);
  assert.doesNotMatch(line, /\(standalone\)/, 'a standalone skill is not a plugin to turn off');
  assert.equal(listingLine(parseListing('nothing here')), '');
});

test('only the head of a transcript is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-listing-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, transcript + '\n' + 'x'.repeat(2000));
  assert.equal(readHead(p, 50).length, 50);
  assert.equal(parseListing(readHead(p)).found, true);
  assert.equal(readHead(join(dir, 'missing.jsonl')), '');
});
