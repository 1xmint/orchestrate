// measure.test.mjs — the meter, on a synthetic transcript with the exact
// record shapes Claude Code writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, report, withoutToolResults } from './measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const usage = (i, o, cr, cw) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });

const RETURN = 'TASK: 9-9-0001\nRESTATED: add the flag\nSTATUS: DONE\nEVIDENCE: pytest -q -> 41 passed';

const LINES = [
  { type: 'user', sessionId: 'abc', timestamp: '2026-09-09T10:00:00Z', message: { content: 'do the thing' } },
  { type: 'user', message: { content: [{ type: 'text', text: '[orch-router · once per session] tier max5 · you: opus @ high effort' }] } },
  { type: 'assistant', effort: 'high', message: { model: 'claude-opus-5', usage: usage(100, 50, 20000, 3000), content: [
    { type: 'tool_use', name: 'Agent', input: { subagent_type: 'orch-implementer', model: 'sonnet', run_in_background: true, prompt: 'TASK: 9-9-0001\nline\nline' } },
  ] } },
  { type: 'user', message: { content: [{ type: 'text', text: RETURN }] } },
  { type: 'assistant', message: { model: 'claude-opus-5', usage: usage(10, 200, 25000, 0), content: [
    { type: 'tool_use', name: 'Agent', input: { subagent_type: 'orch-reviewer', model: 'opus', prompt: 'TASK: 9-9-0002' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
  ] } },
  { type: 'user', message: { content: [{ type: 'text', text: 'orchestrate ledger: the return is missing EVIDENCE' }] } },
  { type: 'assistant', timestamp: '2026-09-09T10:30:00Z', message: { model: 'claude-sonnet-5', usage: usage(5, 5, 100, 0) } },
];

const text = LINES.map(o => JSON.stringify(o)).join('\n') + '\n';

test('tokens, turns, models and the session header', () => {
  const r = measure(text);
  assert.equal(r.session, 'abc');
  assert.equal(r.effort, 'high');
  assert.equal(r.turns, 3);
  assert.equal(r.input, 115);
  assert.equal(r.output, 255);
  assert.equal(r.cacheRead, 45100);
  assert.equal(r.cacheWrite, 3000);
  assert.deepEqual(r.models, { 'claude-opus-5': 2, 'claude-sonnet-5': 1 });
  assert.match(report(r), /claude-opus-5 ×2/);
});

test('only Agent tool_use blocks count as dispatches', () => {
  const r = measure(text);
  assert.equal(r.dispatches.length, 2, 'the Bash call is not a dispatch');
  assert.deepEqual(r.dispatches[0], { agent: 'orch-implementer', model: 'sonnet', background: true, packetLines: 3 });
  assert.equal(r.dispatches[1].model, 'opus');
  assert.match(report(r), /dispatches: 2 — orch-implementer on sonnet ×1, orch-reviewer on opus ×1/);
});

test('returns are counted by their schema, and their length is reported without a verdict', () => {
  const r = measure(text);
  assert.equal(r.returns.length, 1);
  assert.equal(r.returns[0].task, '9-9-0001');
  assert.match(report(r), /returns: 1, 4–4 lines/);

  // A long return is a fact about the work, not a defect. Nothing sends one
  // back for its length any more, so nothing reports it as over a cap either.
  const long = `${RETURN}\n${Array.from({ length: 60 }, () => 'log').join('\n')}`;
  const withLong = measure(JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: long }] } }));
  assert.match(report(withLong), /returns: 1, 64–64 lines/);
  assert.doesNotMatch(report(withLong), /cap/);
});

test('router bytes are counted once, and again for every later assistant turn', () => {
  const r = measure(text);
  assert.equal(r.routerInjections, 1);
  assert.ok(r.routerBytes > 50);
  assert.equal(r.routerReread, r.routerBytes * 3, 'three assistant turns follow the injection');
  assert.ok(r.hookContext > 0, 'the ledger line is counted separately from the router');
  assert.match(report(r), /the router is \d+\.\d\d% of everything this session read/);
});

test('a tool result that quotes the router is not an injection', () => {
  const noisy = JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', content: '[orch-router · once per session] this is test output, not a hook' },
    { type: 'tool_result', content: 'TASK: 9-9-0009\nRESTATED: x\nSTATUS: DONE' },
  ] } });
  const r = measure(noisy);
  assert.equal(r.routerInjections, 0, 'a session reading its own fixtures must not inflate the numbers');
  assert.equal(r.returns.length, 0);
  assert.deepEqual(withoutToolResults([{ type: 'text', text: 'a' }, { type: 'tool_result', content: 'b' }]), [{ type: 'text', text: 'a' }]);
});

test('an empty, corrupt or usage-free transcript reports zeros rather than failing', () => {
  const r = measure('not json\n\n{"type":"assistant","message":{}}\n');
  assert.equal(r.turns, 0);
  assert.equal(r.skipped, 1);
  assert.equal(r.records, 2);
  assert.match(report(r), /dispatches: none/);
  assert.match(report(measure('')), /0 records/);
});

test('the CLI reads a file, and --json round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-meas-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, text);
  const script = join(HERE, 'measure.mjs');

  const human = spawnSync(process.execPath, [script, p], { encoding: 'utf8' });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /session abc/);

  const json = spawnSync(process.execPath, [script, p, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).dispatches.length, 2);

  const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage:/);
});

test('router --cost and measure agree on the same file, because there is one parser', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-agree-'));
  const p = join(dir, 't.jsonl');
  // One real injection, plus a tool result that merely quotes one. The router's
  // own --cost used to count both and disagree with the meter.
  writeFileSync(p, [
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '[orch-router · once per session] tier max5' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'grep hit: [orch-router · once per session] in a test fixture' }] } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: usage(1, 1, 10, 0) } }),
  ].join('\n'));

  const r = measure(readFileSync(p, 'utf8'));
  assert.equal(r.routerInjections, 1);

  const out = spawnSync(process.execPath, [join(HERE, 'router.mjs'), '--cost', p], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^router injections: 1$/m);
  assert.match(out.stdout, new RegExp(`^bytes injected once: ${r.routerBytes} `, 'm'));
});


// ---- what the checks did, and what the session cost --------------------------

import { dollarReport } from './measure.mjs';

// Hook output arrives as an `attachment` record, not as user-role text. Reading
// only the second shape reported "0 router injections" on a transcript that
// plainly held four.
test('an injected hook attachment is counted, and a tool result quoting one is not', () => {
  const lines = [
    JSON.stringify({ type: 'attachment', attachment: { type: 'hook', hookEvent: 'UserPromptSubmit', content: ['[orch-router · once per session] you: opus @ high effort'] } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'cat router.mjs -> [orch-router] ...' }] } }),
  ].join('\n');
  const r = measure(lines);
  assert.equal(r.routerInjections, 1, 'the attachment counts, the tool result does not');
});

test('the one remaining check that can send a turn back is counted by its prefix', () => {
  // One check, not two. The reply check was retired after 0 fires in ~1,800
  // turns; the research floor was retired because two failed fetches satisfied
  // it. A counter for a check that cannot fire reads as a measurement of zero
  // rather than as an absence, so neither has a field here any more.
  const lines = [
    JSON.stringify({ type: 'attachment', attachment: { hookEvent: 'Stop', content: ['orchestrate: Pickup has not changed since the last dispatch. Before this turn ends, update the Pickup section.'] } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 } } }),
  ].join('\n');
  const r = measure(lines);
  assert.equal(r.stopBlocks, 1);
  assert.ok(!('replyChecks' in r) && !('floorBlocks' in r));
  assert.match(report(r), /turns sent back by the Pickup check: 1 in 1 turns/);
});

test('the dollar report prices the session, and refuses to price an unnamed model', () => {
  const r = measure([
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 1000000, output_tokens: 0 } } }),
  ].join('\n'));
  const priced = dollarReport(r, 'max5', null);
  assert.match(priced, /at list price: \$5\.00 on opus/);
  assert.match(priced, /a plan is not billed this way/);
  // No share of a week, on any plan: the weekly figure it divided by came from
  // one observation, and a percentage built on that reads like a measurement.
  assert.doesNotMatch(priced, /% of/);
  assert.doesNotMatch(dollarReport(r, 'api', null), /% of/);

  const noModel = measure(JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1000000 } } }));
  assert.match(dollarReport(noModel, 'max5', null), /not priced/);
});

// The plan document that specified these counters quoted both reasons
// verbatim, and matching the prefix anywhere counted it as two blocks that
// never happened. A block's reason arrives on its own.
test('a message that merely quotes a block reason is not counted as one', () => {
  const quoting = 'The reason text starts "orchestrate: Pickup has not changed since the last dispatch", '
    + 'which is what this repo\'s own notes quote when they explain the check.';
  const r = measure([
    JSON.stringify({ type: 'user', message: { content: quoting } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 1 } } }),
  ].join('\n'));
  assert.equal(r.stopBlocks, 0);
});
