// lead.test.mjs — what the router tells the lead about its own cost: real limit
// messages only, the per-step size at two lines, and a lead effort above
// quota-first, each said once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { limitsFromTail, contextNote, leadNote, CONTEXT_LINES, unreturned, unreturnedNote } from './router.mjs';

test('helpers that never returned are found from dispatch and return records', () => {
  const state = {
    dispatches: [
      { agent: 'orchestrate:orch-implementer', task: '9-9-0001', progress: '/r/progress/9-9-0001.md', at: '1' },
      { agent: 'orchestrate:orch-implementer', task: '9-9-0002', progress: '/r/progress/9-9-0002.md', at: '2' },
      { agent: 'Explore', task: null, key: 'find the router', at: '3' },
    ],
    returned: [{ agent: 'orch-implementer', task: '9-9-0001' }],
  };
  const lost = unreturned(state);
  assert.deepEqual(lost.map(u => u.task), ['9-9-0002', 'find the router']);
  const note = unreturnedNote(state);
  assert.match(note, /2 helpers dispatched this session never returned/);
  assert.match(note, /orch-implementer 9-9-0002 — progress \/r\/progress\/9-9-0002\.md/);
  assert.match(note, /Explore find the router — no PROGRESS file named/);
  assert.equal(unreturnedNote({ dispatches: [{ agent: 'orch-reviewer', task: '1' }], returned: [{ agent: 'orch-reviewer', task: '1' }] }), '');
});
import { lastContextTokens, selfModel } from './lib/tier.mjs';

const synthetic = text => JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
const quoted = text => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });

test('only the host\'s own limit message counts as a limit', () => {
  const tail = [
    quoted('the docs say: "You\'ve hit your Opus limit" and "hit your session limit"'),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'If you hit your Sonnet limit, switch.' }] } }),
  ].join('\n');
  assert.equal(limitsFromTail(tail).size, 0, 'a quote and a sentence about limits are not limits');
  const real = limitsFromTail([tail, synthetic("You've hit your Opus limit · resets 5pm")].join('\n'));
  assert.deepEqual([...real], ['opus']);
  assert.deepEqual([...limitsFromTail(synthetic("You've hit your session limit"))], ['session']);
});

test('the per-step size is said at each line once', () => {
  assert.equal(contextNote(120000, 0), null);
  const first = contextNote(160000, 0);
  assert.equal(first.upTo, CONTEXT_LINES[0]);
  assert.match(first.text, /~160k tokens on every step/);
  assert.equal(contextNote(200000, first.upTo), null, 'not again below the next line');
  assert.equal(contextNote(310000, first.upTo).upTo, CONTEXT_LINES[1]);
  assert.equal(contextNote(900000, CONTEXT_LINES[1]), null);
});

test('a lead above quota-first effort is told once a week per setting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-lead-'));
  const p = join(dir, 'lead-note.json');
  const now = Date.now();
  assert.equal(leadNote({ model: 'opus', effort: 'high' }, 'pro', now, p), '');
  assert.match(leadNote({ model: 'opus', effort: 'xhigh' }, 'pro', now, p), /opus at xhigh effort on plan pro/);
  assert.equal(leadNote({ model: 'opus', effort: 'xhigh' }, 'pro', now + 1000, p), '', 'said once');
  assert.notEqual(leadNote({ model: 'opus', effort: 'xhigh' }, 'pro', now + 8 * 86400000, p), '', 'and again a week later');
  assert.equal(leadNote(null, 'pro', now, p), '');
});

test('the lead\'s size and model skip synthetic records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-lead-'));
  const t = join(dir, 't.jsonl');
  writeFileSync(t, [
    JSON.stringify({ type: 'assistant', effort: 'high', message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 3, cache_read_input_tokens: 150000, cache_creation_input_tokens: 2000 } } }),
    synthetic("You've hit your session limit"),
  ].join('\n'));
  assert.equal(lastContextTokens(t), 152003);
  const prev = process.env.CLAUDE_EFFORT;
  delete process.env.CLAUDE_EFFORT;
  try {
    const me = selfModel(t);
    assert.equal(me.model, 'opus');
    assert.equal(me.effort, 'high');
  } finally { if (prev !== undefined) process.env.CLAUDE_EFFORT = prev; }
});
