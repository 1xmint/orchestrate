// hooks.test.mjs — the three mechanical hooks: the credential guard, the
// ledger, and the Pickup check. Every test runs the real script as a child
// process with a fake HOME and a fixture repo, so nothing here touches the
// machine's own ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReturn, sumUsage, describeDispatch, returnFilename, costLine, appendCost, readCosts, latestPerAgent, COSTS_MAX } from './ledger.mjs';
import { shouldBlock, pickupHash, pickupWritten, pickupSection } from './turn-check.mjs';
import { decide as precompactDecide, unboundDecision } from './precompact-check.mjs';
import { decide, eventId, markSeen } from './guard-agent.mjs';
import { trimLog, runSpend } from './lib/tier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = n => join(HERE, n);

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  return home;
}

test('precompact unbound blocks once per epoch then proceeds', () => {
  const reading = { compaction: { uuid: 'e1' } };
  const one = unboundDecision({ session: 's', reading, prev: {}, checkpoint: false });
  assert.equal(one.block, true);
  assert.match(one.reason, /checkpoint/);
  assert.equal(unboundDecision({ session: 's', reading, prev: { blockedFor: 'e1' }, checkpoint: false }).block, false);
});

function run(name, payload, home, extraEnv = {}) {
  const r = spawnSync(process.execPath, [script(name)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '', ...extraEnv },
  });
  let json = null;
  try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, stdout: r.stdout, json };
}

// A repo with an open run and one planned row.
function fixtureRepo(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const runDir = join(dir, '.orchestrator', 'runs', opts.runId || '20260909-fixture');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), `# Run ${opts.runId || '20260909-fixture'}

## Goal

Ship the flag.

## Tasks

| id | phase | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|
| 9-9-0001 | 🔨 running | implementer · sonnet | add the flag | the test passes | 0 | — |
| 9-9-0002 | 📋 planned | reviewer · opus | review it | PASS | 0 | — |

## Pickup

Pickup prompt: ${opts.pickup ?? '<one sentence that continues from here>'}
Pickup confidence: high
Resume risk: none
`);
  return { dir, runDir, runId: opts.runId || '20260909-fixture', runMd: join(runDir, 'RUN.md') };
}

// Bind a session to a run the way run-init --session-id does, so a hook that
// writes has an association to write through.
function bind(home, sessionId, repo) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    v: 1, session_id: sessionId,
    run: { root: repo.dir, runId: repo.runId, runMd: repo.runMd, boundAt: new Date().toISOString() },
  }));
}

const GOOD_RETURN = `TASK: 9-9-0001
STATUS: DONE
BRANCH: task/9-9-0001
CHANGED: src/tidy.py, tests/test_tidy.py; 2 commits
EVIDENCE: pytest -q -> 41 passed
NOT VERIFIED: Windows path handling`;

const CRED_PACKET = {
  hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'sc', cwd: '/tmp',
  tool_use_id: 'toolu_cred_1',
  tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 1\nuse ghp_abcdefghijklmnopqrstuvwxyz012345 to push' },
};

// ------------------------------------------------------------------- guard --

test('guard: a credential in the packet is denied whatever the model', () => {
  const d = decide({ tool_input: { model: 'sonnet', prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz012345 to push' } });
  assert.equal(d.kind, 'deny');
  assert.match(d.reason, /credential/);
});

test('guard: an ordinary dispatch passes untouched', () => {
  assert.equal(decide({ tool_input: { model: 'opus', prompt: 'TASK: 1' } }).kind, 'pass');
});

// The bug this release exists partly to fix. Deduplication used to run before
// the credential decision, so re-sending a denied packet unchanged within five
// seconds looked like "the same dispatch, already handled" and passed. Sending
// the same request twice is exactly what a model does when a tool call fails.
test('guard: the same credential-bearing packet is denied every time it is sent', () => {
  const home = sandbox();
  for (const attempt of [1, 2, 3]) {
    const out = run('guard-agent.mjs', CRED_PACKET, home);
    assert.equal(out.json.hookSpecificOutput.permissionDecision, 'deny', `attempt ${attempt} denied`);
    assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /credential/);
  }
});

test('guard: a denied attempt is recorded apart from work that actually ran', () => {
  const home = sandbox();
  run('guard-agent.mjs', CRED_PACKET, home);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sc.json'), 'utf8'));
  assert.equal(state.denials.length, 1);
  assert.equal(state.denials[0].agent, 'orch-implementer');
  assert.ok(!state.dispatches || state.dispatches.length === 0, 'a denial is not a dispatch');
});

test('guard: nothing it writes contains the packet text', () => {
  // The packet was denied because it holds something that must not be written
  // down. The old dedupe key stored the first 200 characters of it on disk.
  const home = sandbox();
  run('guard-agent.mjs', CRED_PACKET, home);
  const base = join(home, '.claude', 'orchestrate');
  const files = [];
  const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); n.isDirectory() ? walk(p) : files.push(p); } };
  walk(base);
  assert.ok(files.length, 'the guard wrote something');
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /ghp_abcdefghijklmnopqrstuvwxyz012345/, f);
  }
});

test('guard: one dispatch delivered twice is recorded once', () => {
  const home = sandbox();
  const payload = {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'sd', cwd: home,
    tool_use_id: 'toolu_99',
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\ndo it' },
  };
  const first = run('guard-agent.mjs', payload, home);
  const second = run('guard-agent.mjs', payload, home);
  assert.match(first.stdout, /price tag/);
  assert.equal(second.stdout.trim(), '', 'the second registration of the same hook says nothing');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sd.json'), 'utf8'));
  assert.equal(state.dispatches.length, 1);
});

test('guard: two long packets sharing an opening are two dispatches', () => {
  // The old key was the first 200 characters of the packet. Two packets from
  // the same template — which is what a template is for — collided, and the
  // second dispatch was silently dropped from the record.
  const home = sandbox();
  const prefix = 'TASK: 9-9-0001  ROLE: implementer\n\nOBJECTIVE\n'.padEnd(400, 'x');
  const mk = tail => ({
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'se', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: prefix + tail },
  });
  run('guard-agent.mjs', mk('\nadd the flag'), home);
  run('guard-agent.mjs', mk('\ndelete the flag'), home);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'se.json'), 'utf8'));
  assert.equal(state.dispatches.length, 2);
});

test('guard: two sessions do not overwrite each other in one global slot', () => {
  const home = sandbox();
  const mk = session => ({
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: session, cwd: home,
    tool_use_id: 'toolu_same_id_different_session',
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\ndo it' },
  });
  const a = run('guard-agent.mjs', mk('sf1'), home);
  const b = run('guard-agent.mjs', mk('sf2'), home);
  assert.match(a.stdout, /price tag/);
  assert.match(b.stdout, /price tag/, 'a different session is a different event');
  for (const s of ['sf1', 'sf2']) {
    const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', `${s}.json`), 'utf8'));
    assert.equal(state.dispatches.length, 1, s);
  }
});

test('guard: event identity prefers the ids the host sends', () => {
  const withId = eventId({ session_id: 's', tool_use_id: 'toolu_1', tool_input: { prompt: 'a' } });
  assert.equal(withId, 's:toolu_1');
  // A host that sends no id gets a digest of the whole payload, not a slice of
  // the prompt, and never the prompt itself.
  const legacy = eventId({ session_id: 's', tool_input: { prompt: 'a'.repeat(500) } });
  const legacy2 = eventId({ session_id: 's', tool_input: { prompt: `${'a'.repeat(500)}b` } });
  assert.notEqual(legacy, legacy2);
  assert.doesNotMatch(legacy, /aaaa/);
});

test('guard: the seen-event store expires and stays bounded', () => {
  const now = 1_000_000_000_000;
  const old = markSeen({ stale: { at: now - 90_000_000 } }, 'new', now);
  assert.equal(old.seen, false);
  assert.deepEqual(Object.keys(old.store), ['new'], 'a day-old key is dropped');
  let store = {};
  for (let i = 0; i < 12; i++) store = markSeen(store, `k${i}`, now + i, 86400000, 5).store;
  assert.equal(Object.keys(store).length, 5);
  assert.equal(markSeen(store, 'k11', now + 20, 86400000, 5).seen, true);
});

test('guard: a dispatch is recorded and priced, and never approved', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5' }));
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's2', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\ndo it' },
  }, home);
  assert.match(out.stdout, /price tag: orch-implementer on sonnet/);
  assert.match(out.stdout, /list price, not subscription usage/);
  assert.doesNotMatch(out.stdout, /% of a/, 'no share of a week: nothing here has measured one');
  assert.doesNotMatch(out.stdout, /permissionDecision/, "the user's own approval prompt is untouched");
  assert.equal(out.status, 0);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's2.json'), 'utf8'));
  assert.equal(state.dispatches[0].model, 'sonnet');
});

test('guard: the packet notice names a missing PROGRESS line on an author-role dispatch, plainly, and not in Plan mode', () => {
  const home = sandbox();
  const noProgress = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's3', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0002\ndo it' },
  }, home);
  assert.match(noProgress.stdout, /no PROGRESS line: a capped return will have nothing to resume from/);

  const withProgress = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's4', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0003\nPROGRESS: /r/progress/1.md\ndo it' },
  }, home);
  assert.doesNotMatch(withProgress.stdout, /no PROGRESS line/);

  const reviewer = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's5', cwd: home,
    tool_input: { subagent_type: 'orch-reviewer', model: 'sonnet', prompt: 'TASK: 9-9-0004\nreview it' },
  }, home);
  assert.doesNotMatch(reviewer.stdout, /no PROGRESS line/, 'a reviewer returns a verdict, not partial work');

  const planMode = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's6', cwd: home, permission_mode: 'plan',
    tool_input: { subagent_type: 'orch-researcher', model: 'haiku', prompt: 'TASK: 9-9-0005\nfind it' },
  }, home);
  assert.doesNotMatch(planMode.stdout, /no PROGRESS line/, 'Plan mode already forbids the line');
});

test('guard: an attributable coordinator child is recorded with its parent', () => {
  const home = sandbox();
  const sessionDir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'nested.json'), JSON.stringify({
    v: 1, session_id: 'nested', dispatches: [{
      at: new Date().toISOString(), agent: 'orchestrate:orch-coordinator',
      model: 'opus', task: 'wave', toolUseId: 'toolu_coord',
    }],
  }));
  const lead = join(home, 'lead.jsonl');
  writeFileSync(lead, '');
  const sub = join(home, 'lead', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-coord.meta.json'), JSON.stringify({ agentType: 'orch-coordinator', toolUseId: 'toolu_coord', spawnDepth: 1 }));

  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'nested', cwd: home,
    agent_id: 'coord', transcript_path: lead, tool_use_id: 'toolu_child',
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: child\ndo it' },
  }, home);

  assert.equal(out.status, 0);
  assert.doesNotMatch(out.stdout, /permissionDecision.*deny/);
  const state = JSON.parse(readFileSync(join(sessionDir, 'nested.json'), 'utf8'));
  assert.equal(state.dispatches.at(-1).parent, 'coord');
  assert.equal(state.dispatches.at(-1).task, 'child');
});

test('guard: a dispatch that names no model is recorded as inherited and not priced', () => {
  const home = sandbox();
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's9', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', prompt: 'TASK: 9-9-0001\nPROGRESS: /r/progress/1.md\ndo it' },
  }, home);
  assert.equal(out.stdout.trim(), '', 'no model named means no figure to give, and the packet already names its progress file');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's9.json'), 'utf8'));
  assert.equal(state.dispatches[0].model, 'inherit');
});

// R3: the machine-wide active-run pointer is a display hint for a session
// above any repo ("candidate, not bound" in router.mjs), never authority for
// money. Enforcing its ceiling meant a dispatch from a cwd with no repo above
// it could be denied — or silently allowed — against a completely unrelated
// repo's budget, just because that repo's run happened to be the last one
// opened anywhere on the machine.
test('guard: a dispatch outside any repo is not gated on a stranger repo\'s ceiling via the pointer', () => {
  const home = sandbox();
  const elsewhere = fixtureRepo({ runId: '20260910-elsewhere' });
  // A $0.01 ceiling that any real dispatch crosses — if the gate used the
  // pointer here, this dispatch would be denied against a repo it never asked
  // about.
  writeFileSync(elsewhere.runMd, readFileSync(elsewhere.runMd, 'utf8').replace('## Tasks', '## Budget\n\nCeiling: $0.01 at list price\n\n## Tasks'));
  writeFileSync(join(home, '.claude', 'orchestrate', 'active-run.json'), JSON.stringify({
    v: 1, root: elsewhere.dir, runMd: elsewhere.runMd, at: new Date().toISOString(),
  }));
  const bare = mkdtempSync(join(tmpdir(), 'orch-bare-'));
  const out = run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'sg', cwd: bare,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 1\ndo it' },
  }, home);
  assert.doesNotMatch(out.stdout, /permissionDecision.*deny/, 'not denied against a repo this dispatch never named');
  assert.match(out.stdout, /price tag/, 'the dispatch still goes through and is still priced');
});

test('guard: the run a packet names travels with the dispatch record', () => {
  const home = sandbox();
  run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 'sr', cwd: home,
    tool_input: { subagent_type: 'orch-implementer', model: 'sonnet', prompt: 'TASK: 9-9-0001\nRUN: 20260909-fixture\ndo it' },
  }, home);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sr.json'), 'utf8'));
  assert.equal(state.dispatches[0].run, '20260909-fixture');
});

test('guard: the credential list covers the shapes an audit fed it', () => {
  const shapes = [
    'sk-ant-api03-abcdefghijklmnop',
    'sk-proj-abcdefghijklmnopqrstuvwx',
    'ghp_abcdefghijklmnopqrstuvwxyz012345',
    'github_pat_11ABCDEFG0abcdefghijklmnop',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'xoxb-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'password=hunter2hunter2',
    '-----BEGIN RSA PRIVATE KEY-----',
  ];
  for (const s of shapes) {
    assert.equal(decide({ tool_input: { prompt: `context ${s} more` } }).kind, 'deny', s);
  }
  assert.equal(decide({ tool_input: { prompt: 'the token lives in the env var GITHUB_TOKEN' } }).kind, 'pass');
});

test('guard: an Opus implementer is refused with the exact retry, then allowed after a Sonnet attempt at the same task', () => {
  const home = sandbox();
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'pro' }));
  const send = (model, sid = 'tm') => run('guard-agent.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: sid, cwd: home, tool_use_id: `u-${model}-${Math.random()}`,
    tool_input: { subagent_type: 'orchestrate:orch-implementer', model, prompt: 'TASK: 9-9-0007\nadd the flag' },
  }, home);

  const first = send('opus');
  assert.equal(first.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(first.json.hookSpecificOutput.permissionDecisionReason, /^orchestrate model: .*model: "sonnet"/);
  assert.doesNotMatch(first.json.hookSpecificOutput.permissionDecisionReason, /orchestrate (budget|guard|quota):/, 'a model refusal is a retry, not a stop for the persist loop');

  assert.doesNotMatch(send('sonnet').stdout, /permissionDecision/, 'the Sonnet attempt goes through');
  assert.doesNotMatch(send('opus').stdout, /permissionDecision/, 'escalating the same task after a real attempt is allowed');
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'tm.json'), 'utf8'));
  assert.ok(state.denials.some(d => /^model:/.test(d.reason)), 'the refusal is recorded apart from dispatches');
});

test('guard: a non-Agent tool, garbage input and empty stdin all exit 0 silently', () => {
  const home = sandbox();
  for (const p of [{ tool_name: 'Bash' }, { nonsense: true }, {}]) {
    const out = run('guard-agent.mjs', p, home);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), '');
  }
  const r = spawnSync(process.execPath, [script('guard-agent.mjs')], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

// ------------------------------------------------------------------ ledger --

test('ledger: a good return parses into its fields', () => {
  const r = parseReturn(GOOD_RETURN);
  assert.equal(r.task, '9-9-0001');
  assert.equal(r.status, 'DONE');
  assert.equal(r.evidence, true);
  assert.match(r.changed, /src\/tidy\.py/);
});

test('ledger: a return missing fields still parses, and nothing is demanded back', () => {
  // Leniency is the point. A return that arrives in the wrong shape is still
  // the work; what a missing field costs is certainty, not the work.
  const r = parseReturn('all done, looks fine');
  assert.equal(r.task, null);
  assert.equal(r.status, null);
  assert.equal(r.evidence, false);
  assert.equal(parseReturn(null).lines, 0);
});

test('ledger: an 80-line return is parsed like any other', () => {
  const long = `${GOOD_RETURN}\n${'x\n'.repeat(80)}`;
  const r = parseReturn(long);
  assert.equal(r.status, 'DONE');
  assert.ok(r.lines > 60);
  assert.ok(!('overLong' in r), 'length is not a verdict any more');
});

test('ledger: a reviewer PASS/FAIL verdict is picked up, new schema and old', () => {
  assert.equal(parseReturn('TASK: 1\nSTATUS: DONE\nVERDICT: FAIL\nEVIDENCE: read it').verdict, 'FAIL');
  assert.equal(parseReturn('PASS\nTASK: 1\nSTATUS: DONE\nEVIDENCE: read it').verdict, 'PASS');
});

test('ledger: a verbose legacy return is still read', () => {
  const legacy = `TASK: 9-9-0001
RESTATED: Add a --since flag to tidy, in my own words, over two lines
because the older instruction asked for exactly that.
STATUS: PARTIAL
BRANCH: task/9-9-0001   WORKTREE: /tmp/wt
CHANGED: src/tidy.py
EVIDENCE: pytest -q -> 41 passed
NOT VERIFIED: nothing
QUESTIONS: none`;
  const r = parseReturn(legacy);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.task, '9-9-0001');
  assert.equal(r.evidence, true);
});

test('ledger: usage is summed from the agent transcript, absent fields as zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-tr-'));
  const p = join(dir, 't.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    'not json at all',
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 4 } } }),
  ].join('\n'));
  const u = sumUsage(p);
  assert.deepEqual(u, { input: 14, output: 5, cacheRead: 1000, cacheWrite: 200, turns: 2 });
  assert.deepEqual(sumUsage('/no/such/file'), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 });
});

test('ledger: one API call written as several records counts once, and the model comes from the transcript', () => {
  // The host writes a call per content block (thinking, text, tool_use), each
  // with a copy of the call's usage; early blocks carry a partial output count.
  const dir = mkdtempSync(join(tmpdir(), 'orch-tr-'));
  const p = join(dir, 't.jsonl');
  const rec = (id, out, model = 'claude-opus-5') => JSON.stringify({ type: 'assistant', message: { id, model, usage: { input_tokens: 2, output_tokens: out, cache_read_input_tokens: 200000 } } });
  writeFileSync(p, [rec('msg_1', 1), rec('msg_1', 3), rec('msg_1', 420), rec('msg_2', 1), rec('msg_2', 90), rec('msg_x', 0, '<synthetic>')].join('\n'));
  const u = sumUsage(p);
  assert.equal(u.turns, 3);
  assert.equal(u.cacheRead, 600000, 'not 1,200,000');
  assert.equal(u.output, 510, 'the last record of each call carries its output');
  assert.equal(u.model, 'claude-opus-5', 'a synthetic record is not a model');
});

test('ledger: readers keep one row per agent and never read unpriced as $0', () => {
  const rows = [
    { agent: 'a1', role: 'orchestrate_orch-planner', model: 'opus', dollars: 7 },
    { agent: 'a1', role: 'orchestrate_orch-planner', model: 'opus', dollars: 7.2 },
    { agent: 'a2', role: 'Explore', model: 'unknown', dollars: null },
    { role: 'orch-reviewer', model: 'opus', dollars: 3 },
  ];
  const kept = latestPerAgent(rows);
  assert.equal(kept.length, 3);
  assert.equal(kept.find(r => r.agent === 'a1').dollars, 7.2);
  assert.equal(costLine('orchestrate:orch-planner', 'opus', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'a9').role, 'orch-planner');
  const dir = mkdtempSync(join(tmpdir(), 'orch-spend-'));
  mkdirSync(join(dir, 'returns'));
  writeFileSync(join(dir, 'returns', 'returns.jsonl'), [
    { agentId: 'a1', dollars: 1 }, { agentId: 'a1', dollars: 1.5 }, { agentId: 'a2', dollars: null },
  ].map(o => JSON.stringify(o)).join('\n'));
  assert.equal(runSpend(dir), 1.5);
});

test('ledger: an unnamed model is left unpriced rather than priced as the cheap one', () => {
  const usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, turns: 1 };
  const known = costLine('orch-implementer', 'sonnet', usage);
  assert.equal(known.priced, true);
  assert.ok(known.dollars > 0);
  const unknown = costLine('orch-implementer', '', usage);
  assert.equal(unknown.priced, false);
  assert.equal(unknown.dollars, null);
});

// R1: appendCost used to read the whole file, push one line and write the
// whole file back, so two returns landing together each started from the
// same content and whichever wrote second silently discarded the first's
// cost line. Simulated here as many rapid sequential calls against one file:
// every one of them must survive, which the old read-all/write-all form did
// not guarantee under real concurrency.
test('ledger: appendCost never loses a line under a burst of writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-costs-'));
  const path = join(dir, 'costs.jsonl');
  const n = 30;
  for (let i = 0; i < n; i++) appendCost(costLine('orch-implementer', 'sonnet', { input: i, output: 1, cacheRead: 0, cacheWrite: 0, turns: 1 }), path);
  assert.equal(readCosts(path).length, n, 'every append survived');
});

test('ledger: costs.jsonl trims to its cap and keeps the newest rows', () => {
  // appendCost's own trim is a dice roll (rare on purpose, so it is never what
  // a concurrent write races against); trimLog is the deterministic mechanism
  // it calls, exercised here directly against a costs.jsonl-shaped file.
  const dir = mkdtempSync(join(tmpdir(), 'orch-costs-'));
  const path = join(dir, 'costs.jsonl');
  const rows = Array.from({ length: COSTS_MAX + 50 }, (_, i) => JSON.stringify(costLine('orch-implementer', 'sonnet', { input: i, output: 1, cacheRead: 0, cacheWrite: 0, turns: 1 })));
  writeFileSync(path, rows.join('\n') + '\n');
  assert.equal(readCosts(path).length, COSTS_MAX + 50);
  trimLog(path, COSTS_MAX);
  const after = readCosts(path);
  assert.equal(after.length, COSTS_MAX);
  assert.equal(after[after.length - 1].input, COSTS_MAX + 49, 'the newest row survived the trim');
});

test('ledger: the return is written under the bound run and indexed', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's3', repo);
  const tr = join(repo.dir, 'agent.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1200, output_tokens: 900, cache_read_input_tokens: 30000 } } }));

  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 's3', cwd: repo.dir, agent_id: 'agent_abc123',
    agent_type: 'orch-implementer', agent_transcript_path: tr, last_assistant_message: GOOD_RETURN,
  }, home);

  const files = readdirSync(join(repo.runDir, 'returns')).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^orch-implementer-/, 'named from who returned, not from a file count');
  const saved = readFileSync(join(repo.runDir, 'returns', files[0]), 'utf8');
  assert.ok(saved.includes('EVIDENCE: pytest'), 'the full return is saved, not a summary');

  const index = readFileSync(join(repo.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(index.length, 1);
  assert.equal(index[0].task, '9-9-0001');
  assert.equal(index[0].run, repo.runId);
  assert.equal(index[0].status, 'DONE');
  assert.equal(out.status, 0);
});

test('ledger: a helper stopped at its turn cap with no final message is still recorded', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'capped-stop', repo);
  const tr = join(repo.dir, 'agent.jsonl');
  writeFileSync(tr, Array.from({ length: 100 }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: `m${i}`, usage: { input_tokens: 10, output_tokens: 5 } } })).join('\n'));

  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'capped-stop', cwd: repo.dir, agent_id: 'capped-id',
    agent_type: 'orchestrate:orch-implementer', agent_transcript_path: tr, last_assistant_message: '',
  }, home);

  assert.equal(out.status, 0);
  const index = readFileSync(join(repo.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(index.length, 1, 'a stop that ends on a tool call is a return, not nothing');
  assert.equal(index[0].status, 'PARTIAL');
  assert.equal(index[0].capped, true);
  const returned = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'capped-stop.json'), 'utf8')).returned;
  assert.equal(returned[0].agentId, 'capped-id', 'recorded against the helper, so its worker slot frees');
  assert.equal(returned[0].turns, 100);
});

test('ledger: a nested SubagentStop is filed and indexed with its parent', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'nested-stop', repo);
  const sessionPath = join(home, '.claude', 'orchestrate', 'sessions', 'nested-stop.json');
  const state = JSON.parse(readFileSync(sessionPath, 'utf8'));
  state.dispatches = [{
    at: new Date().toISOString(), agent: 'orch-implementer', model: 'sonnet',
    task: '9-9-0001', run: repo.runId, parent: 'coord-parent', toolUseId: 'toolu_child',
  }];
  writeFileSync(sessionPath, JSON.stringify(state));

  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'nested-stop', cwd: repo.dir,
    agent_id: 'child-id', agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN,
  }, home);

  assert.equal(out.status, 0);
  const index = readFileSync(join(repo.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(index[0].parent, 'coord-parent');
  assert.ok(existsSync(index[0].file), 'the nested return is filed under the run');
  assert.equal(JSON.parse(readFileSync(sessionPath, 'utf8')).returned[0].parent, 'coord-parent');
});

test('ledger: the task rows are left exactly as they were', () => {
  // Two returns landing together each rewrote the whole file, and the second
  // erased the first one's row. The lead sets a row when it has read the
  // return, which is also the only moment anyone has judged it.
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's3b', repo);
  const before = readFileSync(repo.runMd, 'utf8');
  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 's3b', cwd: repo.dir,
    agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN,
  }, home);
  assert.equal(readFileSync(repo.runMd, 'utf8'), before, 'RUN.md is byte-identical');
  assert.equal(out.stdout.trim(), '', 'SubagentStop context lands in the helper and restarts it, so the ledger says nothing');
});

test('ledger: two returns arriving together are both kept', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's3c', repo);
  for (const [agent, id] of [['orch-implementer', 'agent_1'], ['orch-reviewer', 'agent_2']]) {
    run('ledger.mjs', {
      hook_event_name: 'SubagentStop', session_id: 's3c', cwd: repo.dir, agent_id: id,
      agent_type: agent, last_assistant_message: GOOD_RETURN.replace('9-9-0001', agent === 'orch-reviewer' ? '9-9-0002' : '9-9-0001'),
    }, home);
  }
  const files = readdirSync(join(repo.runDir, 'returns')).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 2, 'neither overwrote the other');
  const index = readFileSync(join(repo.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(index.map(x => x.task).sort(), ['9-9-0001', '9-9-0002']);
});

test('ledger: a filename is unique per return and stable for one event', () => {
  const a = returnFilename('orch-implementer', { agent_id: 'agent_abc' }, 'text');
  assert.equal(a, returnFilename('orch-implementer', { agent_id: 'agent_abc' }, 'text'));
  assert.notEqual(a, returnFilename('orch-implementer', { agent_id: 'agent_xyz' }, 'text'));
  const noId = returnFilename('orch-reviewer', { session_id: 's' }, 'one');
  assert.notEqual(noId, returnFilename('orch-reviewer', { session_id: 's' }, 'two'));
  assert.match(noId, /^orch-reviewer-[0-9a-f]{12}\.md$/);
});

test('ledger: two sessions on two runs cannot file into each other', () => {
  const home = sandbox();
  const a = fixtureRepo({ runId: '20260909-alpha' });
  const b = fixtureRepo({ runId: '20260909-beta' });
  bind(home, 'sa', a);
  bind(home, 'sb', b);
  run('ledger.mjs', { hook_event_name: 'SubagentStop', session_id: 'sa', cwd: a.dir, agent_type: 'orch-implementer', agent_id: 'x1', last_assistant_message: GOOD_RETURN }, home);
  run('ledger.mjs', { hook_event_name: 'SubagentStop', session_id: 'sb', cwd: b.dir, agent_type: 'orch-implementer', agent_id: 'x2', last_assistant_message: GOOD_RETURN.replace('9-9-0001', '9-9-0002') }, home);
  assert.equal(readdirSync(join(a.runDir, 'returns')).filter(f => f.endsWith('.md')).length, 1);
  assert.equal(readdirSync(join(b.runDir, 'returns')).filter(f => f.endsWith('.md')).length, 1);
  const ia = readFileSync(join(a.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ia[0].run, '20260909-alpha');
});

test('ledger: an unowned return is kept where the note says, not guessed into a ledger', () => {
  const home = sandbox();
  const bare = mkdtempSync(join(tmpdir(), 'orch-bare-'));
  mkdirSync(join(bare, '.git'), { recursive: true });
  // Another repo's run is open and is the newest on the machine. It must not
  // receive this return: "newest run here" and "the run this session is doing"
  // are not the same thing, and treating them as one filed a return into a
  // closed run in a different repository.
  const other = fixtureRepo({ runId: '20260909-elsewhere' });
  writeFileSync(join(home, '.claude', 'orchestrate', 'active-run.json'), JSON.stringify({ v: 1, root: other.dir, runMd: other.runMd, at: new Date().toISOString() }));

  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'sz', cwd: bare, agent_id: 'a9',
    agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN,
  }, home);

  assert.equal(existsSync(join(other.runDir, 'returns')), false, "the other repo's ledger is untouched");
  const kept = join(home, '.claude', 'orchestrate', 'returns', 'sz');
  assert.ok(existsSync(kept), 'the return is kept somewhere real');
  assert.equal(readdirSync(kept).filter(f => f.endsWith('.md')).length, 1);
  assert.equal(out.stdout.trim(), '');
});

test('ledger: an empty message says nothing, and is filed as a partial stop rather than dropped', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'empty', repo);
  const b = run('ledger.mjs', { hook_event_name: 'SubagentStop', session_id: 'empty', cwd: repo.dir, agent_id: 'e1', agent_type: 'orch-implementer', last_assistant_message: '' }, home);
  assert.equal(b.stdout.trim(), '');
  const index = readFileSync(join(repo.runDir, 'returns', 'returns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(index[0].status, 'PARTIAL', 'a helper that stopped without saying anything did not finish');
});

test('ledger: a stop with no agent identity is not a return', () => {
  // Stops that are not subagent returns arrive carrying a last_assistant_message
  // and no agent field. Accepting those filed twenty-one of the lead's own
  // messages under returns/ in one session.
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'sn', repo);
  const out = run('ledger.mjs', {
    hook_event_name: 'SubagentStop', session_id: 'sn', cwd: repo.dir,
    agent_id: 'abc', last_assistant_message: GOOD_RETURN,
  }, home);
  assert.equal(out.stdout.trim(), '');
  assert.equal(existsSync(join(repo.runDir, 'returns')), false);
});

test('ledger: the same stop delivered twice writes one return', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's6', repo);
  const payload = {
    hook_event_name: 'SubagentStop', session_id: 's6', cwd: repo.dir, agent_id: 'aa',
    agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN,
  };
  run('ledger.mjs', payload, home);
  const second = run('ledger.mjs', payload, home);
  assert.equal(readdirSync(join(repo.runDir, 'returns')).filter(f => f.endsWith('.md')).length, 1);
  assert.equal(second.stdout.trim(), '');
});

// R2: the dedupe used to be one global {sig, ts} slot, so a different return
// landing in between overwrote the slot the first return needed to be checked
// against, and a genuine duplicate stop for the first could pass and get
// filed twice — double-counted in costs.jsonl and returns.jsonl, which the
// spend gate reads. An append-only per-signature log has no slot to clobber.
test('ledger: two different returns landing together do not blind each other\'s dedupe', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's3d', repo);
  const first = { hook_event_name: 'SubagentStop', session_id: 's3d', cwd: repo.dir, agent_id: 'agent_1', agent_type: 'orch-implementer', last_assistant_message: GOOD_RETURN };
  const second = { hook_event_name: 'SubagentStop', session_id: 's3d', cwd: repo.dir, agent_id: 'agent_2', agent_type: 'orch-reviewer', last_assistant_message: GOOD_RETURN.replace('9-9-0001', '9-9-0002') };
  run('ledger.mjs', first, home);
  run('ledger.mjs', second, home); // a different return, landing right after
  const repeatOfFirst = run('ledger.mjs', first, home); // the same first return again
  assert.equal(repeatOfFirst.stdout.trim(), '', 'still recognised as a repeat, even with another return in between');
  const files = readdirSync(join(repo.runDir, 'returns')).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 2, 'one file per distinct return, not three');
});

test('ledger: the model is reported as dispatched, or as inherited', () => {
  assert.equal(describeDispatch({ model: 'opus' }), 'opus');
  assert.equal(describeDispatch({ model: 'inherit' }), 'inherited model');
  assert.equal(describeDispatch(null), null);
});

test('ledger: a helper that stops is never handed context that would restart it', () => {
  const src = readFileSync(script('ledger.mjs'), 'utf8');
  const live = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(live, /additionalContext/);
});

// -------------------------------------------------------------- turn check --

test('turn check: the decision table', () => {
  const written = 'Pickup prompt: carry on from the reviewer FAIL\nPickup confidence: high';
  const unwritten = 'Pickup prompt: <one sentence that continues from here>';
  const at = '2026-09-09T12:00:00Z';
  const later = '2026-09-09T13:00:00Z';
  assert.equal(shouldBlock({ pickupHash: 'h', section: written, lastDispatchAt: null }).block, false);
  assert.equal(shouldBlock({ pickupHash: 'h', section: unwritten, lastDispatchAt: at }).block, true);
  assert.equal(shouldBlock({ pickupHash: 'h2', section: written, lastDispatchAt: at, prev: { hash: 'h1' } }).block, false);
  assert.equal(shouldBlock({ pickupHash: 'h', section: written, lastDispatchAt: later, prev: { hash: 'h', checkedAt: at } }).block, true);
  assert.equal(shouldBlock({ pickupHash: 'h', section: written, lastDispatchAt: at, prev: { hash: 'h', checkedAt: later } }).block, false);
  assert.equal(shouldBlock({ pickupHash: 'h', section: unwritten, lastDispatchAt: at, prev: { blockedFor: 'h' } }).block, false);
});

test('turn check: the Pickup hash changes only when the section changes', () => {
  const a = '## Goal\nx\n\n## Pickup\n\nPickup prompt: one\n';
  const b = '## Goal\nCHANGED\n\n## Pickup\n\nPickup prompt: one\n';
  const c = '## Goal\nx\n\n## Pickup\n\nPickup prompt: two\n';
  assert.equal(pickupHash(a), pickupHash(b));
  assert.notEqual(pickupHash(a), pickupHash(c));
  assert.equal(pickupSection(a), 'Pickup prompt: one');
  assert.equal(pickupWritten('Pickup prompt: <one sentence>'), false);
  assert.equal(pickupWritten('Pickup prompt: continue from the FAIL'), true);
});

test('turn check: a bound run with a stale Pickup blocks once and names the file', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 's7', repo);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const state = JSON.parse(readFileSync(join(sessions, 's7.json'), 'utf8'));
  state.lastDispatchAt = new Date().toISOString();
  writeFileSync(join(sessions, 's7.json'), JSON.stringify(state));

  const first = run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's7', cwd: repo.dir }, home);
  assert.equal(first.json.decision, 'block');
  assert.match(first.json.reason, /Pickup/);
  assert.ok(first.json.reason.includes(repo.runMd), 'it names the file to edit');

  const second = run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's7', cwd: repo.dir }, home);
  assert.equal(second.stdout.trim(), '', 'it blocks once, not in a loop');
});

test('turn check: a session with no bound run says nothing at all', () => {
  // Direct work has no ledger to keep current, and an open run in the repo that
  // this session never claimed is not this session's to be nagged about.
  const home = sandbox();
  const repo = fixtureRepo();
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 's8.json'), JSON.stringify({ v: 1, session_id: 's8', lastDispatchAt: new Date().toISOString() }));
  const out = run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's8', cwd: repo.dir }, home);
  assert.equal(out.stdout.trim(), '');
});

test('turn check: no dispatch, a written Pickup, and a re-entrant call all stay quiet', () => {
  const home = sandbox();
  const quiet = fixtureRepo();
  bind(home, 's10', quiet);
  assert.equal(run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's10', cwd: quiet.dir }, home).stdout.trim(), '');

  const written = fixtureRepo({ pickup: 'continue from the reviewer FAIL' });
  bind(home, 's11', written);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const state = JSON.parse(readFileSync(join(sessions, 's11.json'), 'utf8'));
  state.lastDispatchAt = new Date().toISOString();
  writeFileSync(join(sessions, 's11.json'), JSON.stringify(state));
  // First check records the hash; the Pickup is written, so nothing is blocked.
  assert.equal(run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's11', cwd: written.dir }, home).stdout.trim(), '');

  assert.equal(run('turn-check.mjs', { hook_event_name: 'Stop', session_id: 's11', cwd: written.dir, stop_hook_active: true }, home).stdout.trim(), '');
});

// ---------------------------------------------------------------- precompact --
// WS3: the one unguarded hole in the relay design — a long lead auto-compacts
// mid-run with a stale Pickup line, and the compacted context has no way back
// to where the run was. Same question as the Stop check, reused rather than
// re-implemented, fired one lifecycle point earlier.

test('precompact: the pure decision — no run, no dispatch, and a stale Pickup', () => {
  assert.equal(precompactDecide({ run: null, lastDispatchAt: null, prev: {} }), null);
  assert.equal(precompactDecide({ run: { open: true, runMd: '/x/RUN.md' }, lastDispatchAt: null, prev: {} }), null, 'direct work has no ledger to keep current');
});

test('precompact: a bound run with a stale Pickup blocks compaction once, and names the file', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  bind(home, 'spc1', repo);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const state = JSON.parse(readFileSync(join(sessions, 'spc1.json'), 'utf8'));
  state.lastDispatchAt = new Date().toISOString();
  writeFileSync(join(sessions, 'spc1.json'), JSON.stringify(state));

  const first = run('precompact-check.mjs', { hook_event_name: 'PreCompact', session_id: 'spc1', cwd: repo.dir, trigger: 'auto' }, home);
  assert.equal(first.json.decision, 'block');
  assert.equal(first.json.hookSpecificOutput.hookEventName, 'PreCompact');
  assert.equal(first.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(first.json.hookSpecificOutput.permissionDecisionReason, /Pickup/);
  assert.ok(first.json.reason.includes(repo.runMd), 'it names the file to edit');

  // Never twice for the same unwritten text: PreCompact commonly fires because
  // context is already low, and refusing forever risks the overflow this hook
  // exists to prevent.
  const second = run('precompact-check.mjs', { hook_event_name: 'PreCompact', session_id: 'spc1', cwd: repo.dir, trigger: 'auto' }, home);
  assert.equal(second.stdout.trim(), '', 'it blocks once, not in a loop, and lets compaction proceed');
});

test('precompact: a written Pickup, or no dispatch yet, never blocks', () => {
  const home = sandbox();
  const written = fixtureRepo({ pickup: 'continue from the reviewer FAIL' });
  bind(home, 'spc2', written);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const state = JSON.parse(readFileSync(join(sessions, 'spc2.json'), 'utf8'));
  state.lastDispatchAt = new Date().toISOString();
  writeFileSync(join(sessions, 'spc2.json'), JSON.stringify(state));
  assert.equal(run('precompact-check.mjs', { hook_event_name: 'PreCompact', session_id: 'spc2', cwd: written.dir }, home).stdout.trim(), '');

  const quiet = fixtureRepo();
  bind(home, 'spc3', quiet); // bound, but nothing dispatched yet
  assert.equal(run('precompact-check.mjs', { hook_event_name: 'PreCompact', session_id: 'spc3', cwd: quiet.dir }, home).stdout.trim(), '');
});

// v0.15.0: an unbound session used to compact with nothing saved, and the 472k
// session in STATE.md lost its thread that way. It now gets one block per
// compaction epoch naming where to write the checkpoint, then compaction proceeds.
test('precompact: a session with no bound run is asked for a checkpoint once, then proceeds', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const input = { hook_event_name: 'PreCompact', session_id: 'spc4', cwd: repo.dir };
  const first = run('precompact-check.mjs', input, home);
  const block = JSON.parse(first.stdout);
  assert.equal(block.decision, 'block');
  assert.match(block.reason, /context[\\/]spc4[\\/]checkpoint-/);
  assert.equal(run('precompact-check.mjs', input, home).stdout.trim(), '');
});

// 9-14-0002: the same honesty fix as persist-check.mjs's Stop block — a plan
// file the host wrote this epoch, in Plan mode, is a real checkpoint too.
test('precompact: no bound run, but a plan file touched this epoch, is a real checkpoint', () => {
  const home = sandbox();
  const repo = fixtureRepo();
  const plansDir = join(home, '.claude', 'plans');
  mkdirSync(plansDir, { recursive: true });
  const transcript = join(repo.dir, 't.jsonl');
  const started = new Date(Date.now() - 3600000).toISOString();
  writeFileSync(transcript, JSON.stringify({ type: 'user', timestamp: started, message: { role: 'user', content: 'go' } }) + '\n');
  writeFileSync(join(plansDir, 'fresh.md'), '# plan\n');
  const input = { hook_event_name: 'PreCompact', session_id: 'spc5', cwd: repo.dir, transcript_path: transcript, permission_mode: 'plan' };
  assert.equal(run('precompact-check.mjs', input, home).stdout.trim(), '', 'a fresh plan file stands in for the checkpoint');
});

test('turn check: nothing in it can ask for more research, testing or improvement', () => {
  // The check that used to live here counted the source-reading tool calls in a
  // turn and blocked a recommendation answered from fewer than two. Two failed
  // fetches satisfied it; one authoritative document did not.
  const src = readFileSync(script('turn-check.mjs'), 'utf8');
  const live = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(live, /sourceCalls|WebFetch|WebSearch|floorDecision/);
  assert.doesNotMatch(live, /orch-researcher/);
});
