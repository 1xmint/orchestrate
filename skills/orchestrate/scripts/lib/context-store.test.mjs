// context-store.test.mjs — the on-disk record per session and agent: a
// sample written and read back, incremental reads, the announce/tick marks,
// and the transcript path lookups. Every store lives in a temp dir.
//   node --test skills/orchestrate/scripts/lib/context-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  storePath, findSessionTranscript, agentTranscriptPath, sampleContext,
  storedContext, storedAdvisedKey, markAnnounced, markTicked, lastMeasuredTokens,
} from './context-store.mjs';
import { thresholds } from './context-advice.mjs';
import { loadPolicy } from './policy.mjs';

const policy = () => loadPolicy(null);
const assistantLine = (usage, id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage } }) + '\n';
const boundaryLine = uuid => JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date().toISOString(), compactMetadata: { preTokens: 300000, postTokens: 17000 } }) + '\n';

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-store-home-'));
  const dir = join(home, '.claude', 'orchestrate', 'context');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}
function transcript(lines) {
  const p = join(mkdtempSync(join(tmpdir(), 'orch-store-t-')), 'session.jsonl');
  writeFileSync(p, lines.join(''));
  return p;
}

test('storePath separates the lead from each agent under one session folder', () => {
  const { dir } = tempHome();
  assert.equal(storePath('s1', null, dir), join(dir, 's1', 'lead.json'));
  assert.equal(storePath('s1', 'a/b', dir), join(dir, 's1', 'agent-a_b.json'), 'unsafe characters are replaced');
});

test('sampleContext writes a record that storedContext reads back', () => {
  const { dir } = tempHome();
  const p = transcript([assistantLine({ input_tokens: 1000 }, 'a')]);
  assert.equal(storedContext('s1', null, dir), null, 'nothing before the first sample');
  const first = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.equal(first.reading.tokens, 1000);
  assert.ok(existsSync(storePath('s1', null, dir)));
  const stored = storedContext('s1', null, dir);
  assert.equal(stored.tokens, 1000);
  assert.equal(stored.state, 'measured');
});

test('sampleContext reads incrementally: a second sample sees only what was appended', () => {
  const { dir } = tempHome();
  const p = transcript([assistantLine({ input_tokens: 1000 }, 'a')]);
  sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  writeFileSync(p, [assistantLine({ input_tokens: 1000 }, 'a'), assistantLine({ input_tokens: 5000 }, 'b')].join(''));
  const second = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.equal(second.reading.tokens, 5000);
  assert.equal(second.reading.responsesSinceCompaction, 2, 'the earlier response is carried, not re-counted');
});

test('sampleContext counts a compaction once and keeps the count across samples', () => {
  const { dir } = tempHome();
  const lines = [assistantLine({ input_tokens: 1000 }, 'a'), boundaryLine('e1')];
  const p = transcript(lines);
  assert.equal(sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir }).reading.compactions, 1);
  writeFileSync(p, [...lines, assistantLine({ input_tokens: 20000 }, 'b')].join(''));
  assert.equal(sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir }).reading.compactions, 1);
});

test('advice is announced once: the same advice on the next sample carries no notice', () => {
  const { dir } = tempHome();
  const { checkpointAt } = thresholds(null, policy());
  const p = transcript([assistantLine({ input_tokens: checkpointAt }, 'a')]);
  const first = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.equal(first.advice.action, 'checkpoint');
  assert.equal(first.changed, true);
  assert.notEqual(first.notice, '');
  assert.equal(storedAdvisedKey('s1', null, dir), first.advice.key);
  const again = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.equal(again.changed, false);
  assert.equal(again.notice, '');
});

test('the checkpoint ask is said once per epoch, and again after a compaction', () => {
  const { dir } = tempHome();
  const { checkpointAt } = thresholds(null, policy());
  const lines = [assistantLine({ input_tokens: checkpointAt }, 'a')];
  const p = transcript(lines);
  const first = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.match(first.notice, /write the checkpoint now .* to .*checkpoint-s1\.md$/);
  const again = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.equal(Buffer.byteLength(again.notice), 0, 'second call in the same epoch says nothing');
  writeFileSync(p, [...lines, boundaryLine('e7'), assistantLine({ input_tokens: checkpointAt }, 'b')].join(''));
  const after = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.match(after.notice, /write the checkpoint now .* to .*checkpoint-e7\.md$/, 'a new epoch asks again, for its own file');
});

test('an unannounced sample records nothing until markAnnounced and markTicked are called', () => {
  const { dir } = tempHome();
  const { checkpointAt } = thresholds(null, policy());
  const p = transcript([assistantLine({ input_tokens: checkpointAt }, 'a')]);
  const s = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir, announce: false });
  assert.equal(storedAdvisedKey('s1', null, dir), null);
  markAnnounced('s1', null, s.advice.key, dir);
  assert.equal(storedAdvisedKey('s1', null, dir), s.advice.key);
  markAnnounced('s1', null, null, dir);
  assert.equal(storedAdvisedKey('s1', null, dir), null, 'null forgets, so the advice is said again');
  markTicked('s1', null, 'none|9', dir);
  assert.equal(storedContext('s1', null, dir).tokens, checkpointAt, 'marking does not disturb the reading');
});

test('markAnnounced on a store that does not exist writes nothing', () => {
  const { dir } = tempHome();
  markAnnounced('ghost', null, 'k', dir);
  assert.equal(existsSync(storePath('ghost', null, dir)), false);
});

test('findSessionTranscript finds a session file under any project folder, and rejects unsafe ids', () => {
  const { home } = tempHome();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'proj-a'), { recursive: true });
  const p = join(base, 'proj-a', 'abcd-1234.jsonl');
  writeFileSync(p, '');
  assert.equal(findSessionTranscript('abcd-1234', base), p);
  assert.equal(findSessionTranscript('missing-id', base), null);
  assert.equal(findSessionTranscript('../etc', base), null);
});

test('agentTranscriptPath points next to the lead transcript, and is null when the file is absent', () => {
  const { home } = tempHome();
  const lead = join(home, 'sess.jsonl');
  writeFileSync(lead, '');
  assert.equal(agentTranscriptPath(lead, 'x1'), null);
  mkdirSync(join(home, 'sess', 'subagents'), { recursive: true });
  const a = join(home, 'sess', 'subagents', 'agent-x1.jsonl');
  writeFileSync(a, '');
  assert.equal(agentTranscriptPath(lead, 'x1'), a);
});

test('lastMeasuredTokens is the measured number, or null when only a compaction is known', () => {
  assert.equal(lastMeasuredTokens(transcript([assistantLine({ input_tokens: 7000 }, 'a')]), { capacity: null, policy: policy() }), 7000);
  assert.equal(lastMeasuredTokens(transcript([boundaryLine('e1')]), { capacity: null, policy: policy() }), null);
});
