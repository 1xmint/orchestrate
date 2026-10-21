// context-store.test.mjs — the on-disk record per session and agent: a
// sample written and read back, incremental reads, the announce/tick marks,
// and the transcript path lookups. Every store lives in a temp dir.
//   node --test skills/orchestrate/scripts/lib/context-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
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
  assert.doesNotMatch(after.notice || '', /write the checkpoint now/, 'the plugin wrote the new epoch note itself, so no ask');
  assert.ok(existsSync(join(dir, 's1', 'checkpoint-e7.md')), 'the new epoch has its own file');
});

test('the post-compaction ask fires on the first reading after each compaction when no note can be written, and only once per compaction', () => {
  const { dir } = tempHome();
  // A response has already landed by the time this store samples (not a
  // provisional-only reading): the old `responsesSinceCompaction === 0` gate
  // would miss this.
  const lines1 = [boundaryLine('e1'), assistantLine({ input_tokens: 1000 }, 'a')];
  const p = transcript(lines1);
  // Block the plugin's own note (a folder where its temp file would go), so the
  // ask is what is left.
  for (const e of ['e1', 'e2']) mkdirSync(join(dir, 's1', `checkpoint-${e}.md.${process.pid}.tmp`), { recursive: true });
  const first = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.match(first.notice, /just summarised/, 'a measured first reading after compaction 1 still asks');
  assert.equal(first.reading.compactions, 1);

  // A second sample in the same epoch: no repeat.
  const again = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.doesNotMatch(again.notice || '', /just summarised/, 'not twice for the same compaction');

  // A second compaction: asks again.
  const lines2 = [...lines1, boundaryLine('e2'), assistantLine({ input_tokens: 2000 }, 'b')];
  writeFileSync(p, lines2.join(''));
  const second = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.match(second.notice, /just summarised/, 'a second compaction asks again');
  assert.equal(second.reading.compactions, 2);
});

test('the post-compaction ask does not fire once a checkpoint exists for the epoch', () => {
  const { dir } = tempHome();
  const lines = [boundaryLine('e1'), assistantLine({ input_tokens: 1000 }, 'a')];
  const p = transcript(lines);
  const cpPath = join(dir, 's1', 'checkpoint-e1.md');
  mkdirSync(join(dir, 's1'), { recursive: true });
  writeFileSync(cpPath, 'goal: x\n');
  const r = sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  assert.doesNotMatch(r.notice || '', /just summarised/);
});

test('sampleContext honours a narrow autocompact window for the checkpoint/compact decision, not only the policy default', () => {
  const { dir } = tempHome();
  const p = transcript([assistantLine({ input_tokens: 90000 }, 'a')]);
  const env = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' };
  const first = sampleContext({ transcriptPath: p, session: 's5', policy: policy(), dir, env });
  assert.equal(first.advice.action, 'compact', '90k is already over a 100k window\'s own compact line');
  assert.notEqual(first.notice, '');
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

test('the size line is said once per step of growth; samples inside a step say nothing and keep its key', () => {
  const { dir } = tempHome();
  const every = policy().context.tickEvery;
  const line = tokens => assistantLine({ input_tokens: tokens }, `m${tokens}`);
  const p = transcript([line(every * 2 + 1000)]);
  const sample = () => sampleContext({ transcriptPath: p, session: 's1', policy: policy(), dir });
  const storedTick = () => JSON.parse(readFileSync(storePath('s1', null, dir), 'utf8')).tickKey;

  const first = sample();
  assert.match(first.notice, /^\[orchestrate · context\] ~51k · newest checkpoint: none/, 'the first sample says the size');
  assert.equal(first.tick, 'none|2');
  assert.equal(storedTick(), 'none|2');

  const idle = sample();
  assert.equal(idle.notice, '', 'a file that did not grow says nothing');
  assert.equal(idle.tick, null);

  appendFileSync(p, line(every * 2 + 3000));
  const inside = sample();
  assert.equal(inside.notice, '', 'growth inside the same step says nothing');
  assert.equal(inside.tick, null);
  assert.equal(storedTick(), 'none|2', 'and the key it said is kept');

  appendFileSync(p, line(every * 3 + 1000));
  const next = sample();
  assert.match(next.notice, /^\[orchestrate · context\] ~76k · newest checkpoint: none/, 'the next step is said');
  assert.equal(next.tick, 'none|3');
  assert.equal(storedTick(), 'none|3');
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

test('sampleContext writes the note for each compaction the first time it sees the boundary', () => {
  const { dir } = tempHome();
  const t = transcript([
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'build the thing' } }) + '\n',
    assistantLine({ input_tokens: 100, output_tokens: 10 }, 'm1'),
    boundaryLine('b1-uuid'),
  ]);
  const notePath = (uuid) => join(dir, 's1', `checkpoint-${uuid}.md`);
  const r1 = sampleContext({ transcriptPath: t, session: 's1', policy: policy(), dir });
  assert.ok(existsSync(notePath('b1-uuid')), 'note for the first boundary exists after the first sample');
  assert.ok(r1.notice.includes('checkpoint-b1-uuid.md'), r1.notice);
  appendFileSync(t, boundaryLine('b2-uuid'));
  const r2 = sampleContext({ transcriptPath: t, session: 's1', policy: policy(), dir });
  assert.ok(existsSync(notePath('b2-uuid')), 'note for the second boundary exists too');
  assert.ok(existsSync(notePath('b1-uuid')));
  assert.ok(!/newest checkpoint: none/.test(r2.notice), r2.notice);
});

test('sampleContext does not rewrite a note that exists', () => {
  const { dir } = tempHome();
  const t = transcript([assistantLine({ input_tokens: 100, output_tokens: 10 }, 'm1'), boundaryLine('b1-uuid')]);
  sampleContext({ transcriptPath: t, session: 's1', policy: policy(), dir });
  const f = join(dir, 's1', 'checkpoint-b1-uuid.md');
  writeFileSync(f, 'edited by the lead');
  sampleContext({ transcriptPath: t, session: 's1', policy: policy(), dir, force: true });
  assert.equal(readFileSync(f, 'utf8'), 'edited by the lead');
});

test('sampleContext writes no note for a helper, and none when there is no boundary', () => {
  const { dir } = tempHome();
  const t = transcript([assistantLine({ input_tokens: 100, output_tokens: 10 }, 'm1'), boundaryLine('b1-uuid')]);
  sampleContext({ transcriptPath: t, session: 's1', agent: 'a1', policy: policy(), dir });
  assert.ok(!existsSync(join(dir, 's1', 'checkpoint-b1-uuid.md')), 'helper writes nothing');
  const t2 = transcript([assistantLine({ input_tokens: 100, output_tokens: 10 }, 'm1')]);
  assert.doesNotThrow(() => sampleContext({ transcriptPath: t2, session: 's2', policy: policy(), dir }));
  assert.ok(!existsSync(join(dir, 's2')) || readdirSync(join(dir, 's2')).every(f => !f.startsWith('checkpoint-')));
});
