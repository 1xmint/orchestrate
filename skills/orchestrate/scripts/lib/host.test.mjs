// host.test.mjs — what the running host can do, read from its own transcript
// records and environment, never from a CLI probe.
//   node --test skills/orchestrate/scripts/lib/host.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, hostCapabilities, SINCE } from './host.mjs';

test('compareVersions orders major, minor and patch numerically, not lexically', () => {
  assert.equal(compareVersions('2.1.9', '2.1.10'), -1, 'numeric, so 9 < 10');
  assert.equal(compareVersions('2.2.0', '2.1.257'), 1);
  assert.equal(compareVersions('2.1.196', '2.1.196'), 0);
});

test('compareVersions treats a missing or malformed part as 0', () => {
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
  assert.equal(compareVersions('', '0.0.1'), -1);
  assert.equal(compareVersions(null, null), 0);
});

test('hostCapabilities with no transcript and no env reports unknown engine and no features', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-host-'));
  const caps = hostCapabilities({ env: {}, quotaPath: join(dir, 'quota.json') });
  assert.equal(caps.engine, null);
  assert.equal(caps.hookPromptId, null);
  assert.equal(caps.hookScratchpadDir, null);
  assert.match(caps.engineSource, /unknown/);
  assert.equal(caps.statusLineData, 'not seen on this machine');
});

test('hostCapabilities reads engine version straight from a transcript path and compares against SINCE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-host-'));
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, JSON.stringify({ version: '2.1.257', entrypoint: 'cli' }) + '\n');
  const caps = hostCapabilities({ env: {}, transcriptPath: transcript, quotaPath: join(dir, 'quota.json') });
  assert.equal(caps.engine, '2.1.257');
  assert.equal(caps.entrypoint, 'cli');
  assert.equal(caps.hookPromptId, true, `>= ${SINCE.promptId}`);
  assert.equal(caps.hookScratchpadDir, true, `>= ${SINCE.scratchpadDir}`);
});

test('an engine older than a feature\'s SINCE version reports that feature as false, not unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-host-'));
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, JSON.stringify({ version: '2.0.1' }) + '\n');
  const caps = hostCapabilities({ env: {}, transcriptPath: transcript, quotaPath: join(dir, 'quota.json') });
  assert.equal(caps.hookPromptId, false);
  assert.equal(caps.hookScratchpadDir, false);
});

test('statusLineData reflects whether the quota file exists on this machine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-host-'));
  const quotaPath = join(dir, 'quota.json');
  writeFileSync(quotaPath, '{}');
  const caps = hostCapabilities({ env: {}, quotaPath });
  assert.equal(caps.statusLineData, 'seen');
});
