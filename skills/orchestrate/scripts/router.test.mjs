// router.test.mjs — what the context provider says, and the much larger set of
// things it no longer says.
//   node --test $(find skills -name '*.test.mjs')
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardBody, syntheticPrompt, sectionExcerpt, RESUME_CAP, actionableLine, BRIEF_CAP } from './router.mjs';
import { AGENT_NAMES } from './lib/tier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTER = join(HERE, 'router.mjs');

function makeHome(agentNames = AGENT_NAMES) {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5', tierSource: 'user', setAt: '2026-09-08T00:00:00Z' }));
  // Most router tests are about ordinary prompts, not this one-time migration.
  writeFileSync(join(home, '.claude', 'orchestrate', 'autocompact-default.json'), '{}');
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  for (const n of agentNames) {
    writeFileSync(join(home, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\n---\n`);
  }
  return home;
}

test('auto-compact is offered once, on the second substantive prompt, and writes nothing', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.doesNotMatch(first, /Tip: this plugin works best/, 'the tip waits so the session-opening payload stays small');
  const second = prompt(home, repo, 'another substantive prompt goes here too');
  assert.match(second, /Tip: this plugin works best with Claude Code's auto-compact set to 200k tokens\. Type `autocompact on`/);
  assert.equal(existsSync(join(home, '.claude', 'settings.json')), false, 'the offer alone never writes settings.json');
  assert.equal(prompt(home, repo, 'a third substantive prompt for good measure'), '', 'the marker makes later prompts cheap and silent, offer or not');
});

test('a non-substantive first prompt does not spend the one-time offer', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  assert.equal(prompt(home, repo, 'ok'), '', 'too short to be substantive, so no tip and no marker spent');
  assert.equal(existsSync(marker), false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.doesNotMatch(first, /Tip: this plugin works best/, 'the first substantive prompt still defers the tip');
  const second = prompt(home, repo, 'another substantive prompt goes here too');
  assert.match(second, /Tip: this plugin works best/, 'the tip arrives on the next substantive prompt');
});

test('a HOME whose settings.json already sets auto-compact gets no tip and no write', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '12345' } }));
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.doesNotMatch(first, /Tip: this plugin/);
  assert.equal(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '12345', 'untouched');
});

test('"autocompact on" writes the key, replies with the compact note, and sends no card or persist arming', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'autocompact on', { session_id: 's-auto-on' });
  assert.match(first, /auto-compact setting was changed to 200k/);
  assert.doesNotMatch(first, /\[orchestrate\]/, 'no card');
  assert.doesNotMatch(first, /\[orchestrate · persist\]/, 'no auto-continue armed');
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
  assert.doesNotMatch(first, /~[\\/]\.claude[\\/]settings\.json/, 'no raw settings path');

  const off = prompt(home, repo, 'autocompact off', { session_id: 's-auto-on' });
  assert.match(off, /auto-compact setting was removed/);
  const after = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(after.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined, 'the key is gone');
});

test('the typed command is case- and space-insensitive', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, '  AUTOCOMPACT ON  ', { session_id: 's-auto-case' });
  assert.match(out, /auto-compact setting was changed to 200k/);
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
});

function makeRepo(withRun, opts = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (withRun) {
    const dir = join(repo, '.orchestrator', 'runs', opts.runId || '20260908-tidy-finish');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'RUN.md'), [
      `# Run ${opts.runId || '20260908-tidy-finish'}`, '',
      '## Goal', '', 'Finish the tidy command so notes stop piling up.', '',
      'Why it matters: the user files notes by hand today.', '',
      '## Done when', '', '- `pytest -q` passes and no note is lost', '',
      '## Constraints and non-goals', '', '- constraint: the never-delete rule holds', '',
      '## Approach', '', 'Current approach: add --since, then widen it.', 'Next deliverable: the flag with its test.', '',
      '## Tasks', '',
      // Old seven-column table on purpose, unless a test asks for the newer one.
      // Runs written before the dependency columns existed are on people's
      // disks and have to keep working.
      ...(opts.rows || [
        '| id | phase | role · model | task | acceptance evidence | attempts | result |',
        '|---|---|---|---|---|---|---|',
        '| 9-8-0001 | 🔨 running | implementer · sonnet | add --since | test passes | 1 | — |',
      ]), '',
      '## Decisions', '', '- 2026-09-08 — file dates, not git dates — the repo has no history for them', '',
      '## Pickup', '', 'Pickup prompt: dispatch 9-8-0002 once 0001 lands', 'Pickup confidence: high', 'Resume risk: mild', '',
      '## Verified vs inherited', '', 'Verified directly: none', '',
    ].join('\n'));
  }
  return repo;
}

function run(home, payload) {
  const r = spawnSync(process.execPath, [ROUTER], {
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
    // CLAUDE_EFFORT is cleared so a test run inside a Claude Code session does
    // not hand the router that session's own effort.
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  const out = r.stdout.trim();
  if (!out) return '';
  const j = JSON.parse(out);
  return j.hookSpecificOutput.additionalContext;
}

function prompt(home, cwd, text, extra = {}) {
  return run(home, { hook_event_name: 'UserPromptSubmit', session_id: extra.session_id || 'sess-a', prompt_id: extra.prompt_id || `p${Math.random()}`, cwd, permission_mode: 'auto', prompt: text, ...extra });
}

// Counter phrases the card must never carry — those live behind `router status`.
const NO_COUNTERS = /orch-agents|codex:|tier |limits today/;

test('the first substantive prompt gets the card only, once, with no counters', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, /\[orchestrate\]/);
  assert.match(first, /orchestrate is loaded/);
  assert.doesNotMatch(first, NO_COUNTERS, 'the card carries no counters');
  assert.doesNotMatch(first, /you: model not known here/);

  const second = prompt(home, repo, 'now do the same for the list command and test that too');
  assert.equal(second, '', 'nothing changed, so there is nothing to say');
});

test('a small first prompt gets the short card, under 600 characters, with no full-card text; a later larger prompt earns the full card once', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'fix the typo in the README', { session_id: 's-small' });
  assert.ok(first.length < 600, `short-card turn is ${first.length} characters`);
  assert.doesNotMatch(first, /orchestrate is loaded\. The user owns/, 'the full card did not go out');
  assert.match(first, /orchestrate is loaded/);

  const second = prompt(home, repo, 'build me a small app with a login page and tests', { session_id: 's-small' });
  assert.match(second, /orchestrate is loaded\. The user owns/, 'the full card arrives on the first larger request');

  const third = prompt(home, repo, 'now do the same for the list command and test that too', { session_id: 's-small' });
  assert.equal(third, '', 'the full card was already spent, once');
});

test('a large first prompt still gets the full card, not the short one', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it', { session_id: 's-large' });
  assert.match(first, /orchestrate is loaded\. The user owns/);
});

test("a helper's own first prompt (agent_id present) gets neither card, short or full, for a small prompt", () => {
  const home = makeHome(); const repo = makeRepo(false);
  const inside = prompt(home, repo, 'fix the typo in the README', { session_id: 's-small-helper', agent_id: 'a1' });
  assert.equal(inside, '', 'a subagent call is not the lead session, so it gets no card');
});

test('`router status` replies with the full state line and sends no card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = prompt(home, repo, 'router status', { session_id: 's-status' });
  assert.match(out, /\[orchestrate\]/);
  assert.match(out, /tier max5/);
  assert.match(out, new RegExp(`orch-agents ${AGENT_NAMES.length}/${AGENT_NAMES.length}`));
  assert.match(out, /run: none/);
  assert.doesNotMatch(out, /orchestrate is loaded/, 'the rules card is not sent for a status request');

  // Not a substantive prompt: it did not arm the card or persist.
  const after = prompt(home, repo, 'add a --json flag to the status command and test it', { session_id: 's-status' });
  assert.match(after, /orchestrate is loaded/, 'the card is still owed after a status request');
});

// `router status` is a prompt the user types, not a command-line argument.
// Round 8 ran `router.mjs status` with `{}` on stdin and got 0 B: the argument
// is not a command and `{}` names no hook event, so silence is intended.
test('`router.mjs status` on the command line with `{}` prints nothing; the prompt is the way in', () => {
  const home = makeHome();
  const r = spawnSync(process.execPath, [ROUTER, 'status'], {
    input: '{}', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a hook firing inside a subagent (agent_id present) prints nothing on UserPromptSubmit, and prints the card without it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const inside = prompt(home, repo, 'add a --json flag to the status command and test it', { agent_id: 'agent-1' });
  assert.equal(inside, '', 'a subagent call is not the lead session, so it gets no card');
  const outside = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(outside, /\[orchestrate\]/, 'the same payload without agent_id still gets the card');
});

test('a hook firing inside a subagent (agent_id present) prints nothing on SessionStart, and prints the card without it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const inside = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-agent', cwd: repo, agent_id: 'agent-1' });
  assert.equal(inside, '', 'a subagent compacting its own transcript gets no card');
  const outside = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-agent2', cwd: repo });
  assert.match(outside, /\[orchestrate/, 'the same payload without agent_id still prints');
});

test('a partial install of the role agents says so on the first card, once, and names the count', () => {
  const home = makeHome([]); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, new RegExp(`Only 0 of the plugin's ${AGENT_NAMES.length} helper roles are installed`));
  assert.match(first, /claude plugin install orchestrate@orchestrate/);
  const second = prompt(home, repo, 'now do the same for the list command and test that too');
  assert.doesNotMatch(second, /helper roles are installed/, 'said once per session');
});

test('a helper\'s own first prompt never hears the partial-install notice', () => {
  const home = makeHome([]); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it', { agent_id: 'a1' });
  assert.doesNotMatch(first, /helper roles are installed/);
});

test('all eight role agents installed: no partial-install notice', () => {
  const home = makeHome(AGENT_NAMES); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.doesNotMatch(first, /helper roles are installed/);
});

// Pinned: the whole first-prompt payload in a fresh home, worst case (a
// partial install and a missing brief section both firing alongside the
// card), stays under 2,500 B — the autocompact tip is deferred to the second
// substantive prompt precisely so this worst case still fits.
test('the whole first-prompt payload in a fresh home stays under 2,500 bytes', () => {
  const home = makeHome([]); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  const bytes = Buffer.byteLength(first, 'utf8');
  assert.ok(bytes <= 2500, `first payload is ${bytes} bytes, cap 2500`);
  assert.doesNotMatch(first, /Tip: this plugin/, 'the tip is deferred off the first payload');
  assert.match(first, /helper roles are installed/, 'the install notice is part of the worst case measured');
  assert.match(first, /no "What this is for" section/, 'the brief-missing note is part of the worst case measured');
});

test('the wording of a message never produces an instruction', () => {
  // Every one of these used to trigger a rung line naming an agent, a research
  // depth, a reviewer or a permission request. A pattern in the wording is not
  // evidence about the work.
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'set up the project so it builds', { session_id: 's-quiet' });
  const messages = [
    'add a --json flag, write the tests, then get it reviewed before we deploy',
    'what is the currently recommended way to read a .env file in node 22',
    'is it a good idea to move the ledger to sqlite',
    'rename the config field in every package and open a PR for each',
    'how many files import the client module',
    'wait until CI goes green and then tell me',
    'research the options, decide an approach, then migrate the schema',
    'is there a recommended model and effort for each subscription tier',
    'fix the auth bug in session.ts, client.ts, router.ts, api.ts, db.ts and web.ts',
  ];
  for (const m of messages) {
    // The tenth prompt of a session carries the goal, a fact and not an instruction.
    const out = prompt(home, repo, m, { session_id: 's-quiet' }).replace(/\[orchestrate · goal\] [^\n]*/, '');
    assert.equal(out, '', `the router stayed out of it: ${m}`);
  }
});

test('nothing shipped in the router names an agent, a rung or a model to use', () => {
  const src = readFileSync(ROUTER, 'utf8');
  const live = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(live, /orch-implementer|orch-reviewer|orch-researcher|orch-planner|orch-debugger/);
  assert.doesNotMatch(live, /rung|classify|hintFor|MANAGER_SETUP|managerAdvice|reviewClause/);
  // The regular-expression table that read every message is gone with them.
  assert.doesNotMatch(live, /const RX = \{/);
});

test('non-substantive prompts are silent and do not spend the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  for (const t of ['/orchestrate', 'ok', '```\ncode\n```']) {
    assert.equal(prompt(home, repo, t, { session_id: 's-nonsub' }), '');
  }
  assert.match(prompt(home, repo, 'add the flag and test it properly', { session_id: 's-nonsub' }), /orchestrate is loaded/);
});

test("a background-task notice is the host's prompt, not the user's: it arms nothing and pins no goal", () => {
  const home = makeHome(); const repo = makeRepo(false);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const read = () => JSON.parse(readFileSync(join(sessions, 's-synth.json'), 'utf8'));
  // Seen live: a finished helper's notice contained "keep going until ..." from
  // the task's own text and the router pinned it as the user's goal.
  const notice = ['[SYSTEM NOTIFICATION - NOT USER INPUT]', 'This is an automated background-task event.', '<task-notification>', '<result>keep coding until the website is done, please use opus</result>', '</task-notification>'].join(String.fromCharCode(10));
  assert.equal(prompt(home, repo, notice, { session_id: 's-synth' }), '', 'no card, no state line');
  const s = read();
  assert.ok(!(s.persist && s.persist.armed), 'not armed');
  assert.equal(s.userModel, undefined, 'no model grant from a notice');
  assert.equal(prompt(home, repo, '<task-notification>' + String.fromCharCode(10) + '<summary>done</summary>', { session_id: 's-synth' }), '');
  // The user's own next words still work as before.
  assert.match(prompt(home, repo, 'keep coding until the website is done', { session_id: 's-synth' }), /auto-continue is on toward/);
  assert.equal(read().persist.armed, true);
  assert.equal(syntheticPrompt('  [SYSTEM NOTIFICATION - NOT USER INPUT] x'), true);
  assert.equal(syntheticPrompt('the system notification said to keep going'), false);
});

test("a helper's hand-back, or another session's message, is never the user's goal either", () => {
  const home = makeHome(); const repo = makeRepo(false);
  const sessions = join(home, '.claude', 'orchestrate', 'sessions');
  const read = () => JSON.parse(readFileSync(join(sessions, 's-handback.json'), 'utf8'));
  // Seen live 2026-09-26: the auto-continue hook took a helper's hand-back,
  // opening with an <agent-message> tag and "[Subagent hand-back]" on the
  // next line, as the lead's own goal.
  const handback = ['<agent-message from="orch-implementer">', '[Subagent hand-back]', 'keep going until the whole plan is done'].join(String.fromCharCode(10));
  assert.equal(prompt(home, repo, handback, { session_id: 's-handback' }), '', 'no card, no state line');
  let s = read();
  assert.ok(!(s.persist && s.persist.armed), 'not armed');
  assert.equal(s.goal, undefined, 'never becomes the session goal');

  const relayed = 'Another Claude session sent a message: build the entire feature and ship it';
  assert.equal(prompt(home, repo, relayed, { session_id: 's-handback', prompt_id: 'p2' }), '');
  s = read();
  assert.ok(!(s.persist && s.persist.armed));
  assert.equal(s.goal, undefined);

  const ciEvent = '<ci-monitor-event>keep going until it is green</ci-monitor-event>';
  assert.equal(prompt(home, repo, ciEvent, { session_id: 's-handback', prompt_id: 'p3' }), '');
  assert.ok(!(read().persist && read().persist.armed));

  for (const t of [
    '<agent-message from="orch-implementer">\n[Subagent hand-back]\nkeep going',
    '[Subagent hand-back]\nbuild the entire dashboard',
    'Another Claude session sent a message: fix the tests',
    '<ci-monitor-event>build the whole thing</ci-monitor-event>',
  ]) {
    assert.equal(syntheticPrompt(t), true, t);
  }
  assert.equal(syntheticPrompt('please tell me about agent-message formats'), false);
});

test('the same prompt_id twice is emitted once (double registration)', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const p = { session_id: 's-dup', prompt_id: 'p-1' };
  assert.match(prompt(home, repo, 'add a --json flag to status and test it', p), /orchestrate is loaded/);
  assert.equal(prompt(home, repo, 'add a --json flag to status and test it', p), '');
});

test('a state change is worth a line; a change of wording is not', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-state' });
  assert.equal(prompt(home, repo, 'and one for list as well please', { session_id: 's-state' }), '');
  // A family limit hit mid-session is a fact the model cannot see.
  const tr = join(repo, 't.jsonl');
  // The host writes its limit message as a "<synthetic>" assistant record.
  writeFileSync(tr, [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'working on it' }] } }),
    JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your Opus limit" }] } }),
  ].join('\n'));
  const after = prompt(home, repo, 'carry on with the list command now', { session_id: 's-state', transcript_path: tr });
  assert.match(after, /\[orchestrate · changed\] Today's limit on Opus is reached; helpers on it are refused until it resets\./);
});

test('an open run is named, and its goal comes with it', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const first = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-run' });
  assert.match(first, /This session continues the run at .*20260908-tidy-finish.*RUN\.md\./);
  assert.match(first, /Goal: Finish the tidy command/);
  assert.match(first, /Pickup: Pickup prompt: dispatch 9-8-0002/);
  // The task rows are not re-injected: they are long, mostly finished, and on
  // disk. What a session needs back is the goal it lost.
  assert.doesNotMatch(first, /9-8-0001/);
});

test('resume and compaction carry the goal, the constraints and the Pickup', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const out = run(home, { hook_event_name: 'SessionStart', source: 'resume', session_id: 's-res', cwd: repo });
  assert.match(out, /\[orchestrate · resumed\]/);
  assert.ok(out.includes(join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md')), 'the full path, so it can be opened');
  assert.match(out, /Goal: Finish the tidy command/);
  assert.match(out, /Done when: - `pytest -q` passes/);
  assert.match(out, /Constraints and non-goals:/);
  assert.match(out, /Decisions: - 2026-09-08 — file dates/);
  assert.match(out, /Pickup: Pickup prompt: dispatch 9-8-0002/);

  const compacted = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-res2', cwd: repo });
  assert.match(compacted, /\[orchestrate · compacted\]/);
  assert.match(compacted, /Goal: Finish the tidy command/);
});

test('a compaction re-sends the card, ahead of the run excerpt, and a resume does not', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const card = cardBody();
  const compacted = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-card1', cwd: repo });
  assert.ok(compacted.includes(card), 'the whole card comes back after a summary');
  assert.ok(compacted.indexOf(card) < compacted.indexOf('Goal: Finish the tidy command'), 'the card comes first');
  const resumed = run(home, { hook_event_name: 'SessionStart', source: 'resume', session_id: 's-card2', cwd: repo });
  assert.ok(!resumed.includes(card), 'a resume keeps the conversation, card included');
  run(home, { hook_event_name: 'UserPromptSubmit', prompt: 'router off', session_id: 's-card3', cwd: repo });
  const muted = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-card3', cwd: repo });
  assert.ok(!muted.includes(card), 'a muted card stays muted');
});

test('the after-compaction line states facts, not an instruction', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const sid = 's-fact1';
  run(home, { hook_event_name: 'UserPromptSubmit', prompt: 'finish the tidy command', session_id: sid, cwd: repo });
  const p = join(home, '.claude', 'orchestrate', 'sessions', `${sid}.json`);
  const state = JSON.parse(readFileSync(p, 'utf8'));
  state.dispatches = [
    { at: '2026-09-21T10:00:00Z', agent: 'orchestrate:orch-advisor', model: 'opus' },
    { at: '2026-09-21T10:05:00Z', agent: 'orch-implementer', model: 'sonnet' },
    { at: '2026-09-21T10:09:00Z', agent: 'Explore', model: 'haiku' },
  ];
  writeFileSync(p, JSON.stringify(state));
  const first = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sid, cwd: repo });
  assert.match(first, /\[orchestrate · after compaction\] The conversation was summarised\. The card below was in view before the summary and is not in it\. Compaction 1 of this session\. 3 helpers sent so far; orch-advisor last sent: 2 helpers ago\./);
  assert.ok(first.indexOf('after compaction') < first.indexOf(cardBody()), 'the fact introduces the card');
  const second = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sid, cwd: repo });
  assert.match(second, /Compaction 2 of this session/);
  // Facts only: nothing in the line tells the lead what to do.
  const line = /\[orchestrate · after compaction\][^\n]*/.exec(second)[0];
  assert.doesNotMatch(line, /\b(should|must|send|call|dispatch|consider)\b/i);
  // compactionFact's own direct-call tests moved to lib/recover.test.mjs.
});

test('SessionStart compact with no bound run names the checkpoint file, not its text', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const sessionId = 's-checkpoint1';
  const dir = join(home, '.claude', 'orchestrate', 'context', sessionId);
  mkdirSync(dir, { recursive: true });
  const long = 'checkpoint text '.repeat(200); // well over any per-notice cap
  const cpPath = join(dir, 'checkpoint-e1.md');
  writeFileSync(cpPath, long);
  const t = join(mkdtempSync(join(tmpdir(), 'orch-cp-t-')), 'session.jsonl');
  writeFileSync(t, JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'e1', timestamp: new Date().toISOString(), compactMetadata: { preTokens: 150000, postTokens: 20000 } }) + '\n');

  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sessionId, cwd: repo, transcript_path: t });
  assert.match(out, /\[orchestrate · compacted\] checkpoint: /);
  assert.ok(out.includes(cpPath), 'names the file');
  assert.ok(!out.includes('checkpoint text checkpoint text'), 'never injects the file\'s own text');
});

test('the compacted line names no checkpoint that is old or has no boundary to belong to', () => {
  const stale = (file, mtimeAgoMs, uuid) => {
    const home = makeHome(); const repo = makeRepo(false);
    const sid = 's-cpstale';
    const dir = join(home, '.claude', 'orchestrate', 'context', sid);
    mkdirSync(dir, { recursive: true });
    const cp = join(dir, file);
    writeFileSync(cp, 'x');
    const when = new Date(Date.now() - mtimeAgoMs);
    utimesSync(cp, when, when);
    const t = join(mkdtempSync(join(tmpdir(), 'orch-cp-t-')), 'session.jsonl');
    writeFileSync(t, uuid ? JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date().toISOString(), compactMetadata: { preTokens: 1, postTokens: 1 } }) + '\n' : '');
    return run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sid, cwd: repo, transcript_path: t });
  };
  const said = /\[orchestrate · compacted\] checkpoint note follows at first action/;
  assert.match(stale('checkpoint-e1.md', 5 * 60000, 'e1'), said, 'written five minutes ago');
  assert.match(stale('checkpoint-e1.md', 1000, null), said, 'no boundary visible yet');
  assert.doesNotMatch(stale('checkpoint-e1.md', 1000, 'e1'), /follows at first action/);
});

// unreturned/unreturnedNote's own direct-call test moved to lib/recover.test.mjs.

test('a single unambiguous open run binds itself; two do not', () => {
  const home = makeHome(); const repo = makeRepo(true);
  prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-bind' });
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-bind.json'), 'utf8'));
  assert.equal(state.run.runId, '20260908-tidy-finish', 'a hook that writes now has an association');

  const second = join(repo, '.orchestrator', 'runs', '20260909-other');
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  prompt(home, repo, 'start on the second piece of work now please', { session_id: 's-bind2' });
  const status = prompt(home, repo, 'router status', { session_id: 's-bind2' });
  assert.match(status, /2 candidates/);
  const s2 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-bind2.json'), 'utf8'));
  assert.equal(s2.run, undefined, 'ambiguous means unbound, not a guess');
});

test('a session above its own repo, with nothing else in play, is offered the run as a candidate, never bound to it', () => {
  // The pointer root itself carries no .git, so findRepoRoot never finds it —
  // this is the "session started above the project" shape the pointer exists
  // for, not an ordinary repo session (which resolves its own open runs and
  // never reads the pointer at all).
  const home = makeHome();
  const pointerRoot = mkdtempSync(join(tmpdir(), 'orch-pointer-root-'));
  const runDir = join(pointerRoot, '.orchestrator', 'runs', '20260908-tidy-finish');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  writeFileSync(join(home, '.claude', 'orchestrate', 'active-run.json'), JSON.stringify({
    v: 1, root: pointerRoot, runMd: join(runDir, 'RUN.md'), at: new Date().toISOString(),
  }));

  // cwd under the pointer's own root: the run's picture is shown so a session
  // above its repo can still see what is ready, but it is labelled a
  // candidate and the session is not bound: display is read-only, and a hook
  // that writes still needs the binding.
  const sub = join(pointerRoot, 'sub');
  mkdirSync(sub, { recursive: true });
  const under = prompt(home, sub, 'pick up where we left off on the tidy work', { session_id: 's-under' });
  const statusUnder = prompt(home, sub, 'router status', { session_id: 's-under' });
  assert.match(statusUnder, /candidate, not bound/);
  const stateUnder = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-under.json'), 'utf8'));
  assert.equal(stateUnder.run, undefined);
});

test('active-run.json names a project the session has nothing to do with: no run phrase at all', () => {
  // The bug this guards: a session in one project must not be told about a
  // run from another project just because that one happened to be the last
  // run opened on the machine.
  const home = makeHome();
  const pointerRoot = mkdtempSync(join(tmpdir(), 'orch-pointer-root-'));
  const runDir = join(pointerRoot, '.orchestrator', 'runs', '20260908-tidy-finish');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  writeFileSync(join(home, '.claude', 'orchestrate', 'active-run.json'), JSON.stringify({
    v: 1, root: pointerRoot, runMd: join(runDir, 'RUN.md'), at: new Date().toISOString(),
  }));
  const unrelated = mkdtempSync(join(tmpdir(), 'orch-unrelated-'));
  const out = prompt(home, unrelated, 'pick up where we left off on the tidy work', { session_id: 's-unrelated' });
  assert.doesNotMatch(out, /candidate/);
  assert.doesNotMatch(out, /continues the run/);
  const status = prompt(home, unrelated, 'router status', { session_id: 's-unrelated' });
  assert.match(status, /run: none/);
  assert.doesNotMatch(status, /candidate/);
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-unrelated.json'), 'utf8'));
  assert.equal(state.run, undefined);
});

test('a prompt naming a model family records userModel for guard-agent to read; an ordinary prompt records nothing', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'use opus for this one, it is worth it', { session_id: 's-model' });
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-model.json'), 'utf8'));
  assert.equal(state.userModel.family, 'opus');
  assert.ok(state.userModel.at);
  assert.equal(state.userModel.taskId, undefined, 'router only records the naming; the grant binds to a task in guard-agent');

  prompt(home, repo, 'add a --json flag to the status command and test it', { session_id: 's-nomodel' });
  const s2 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-nomodel.json'), 'utf8'));
  assert.equal(s2.userModel, undefined, 'no family named, nothing recorded');
});

test('naming a family records the earliest one in the prompt, not the ladder\'s own order; a later prompt naming only Sonnet leaves it alone', () => {
  const home = makeHome(); const repo = makeRepo(false);
  // FAMILY_ORDER is ['fable', 'opus', 'sonnet', 'haiku'], so .find used to
  // check fable before opus regardless of where each word actually sits in
  // the sentence — "use opus, not fable" recorded fable even though opus is
  // what the user asked for and fable is what they ruled out.
  prompt(home, repo, 'use opus, not fable, for this one', { session_id: 's-order' });
  const s1 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-order.json'), 'utf8'));
  assert.equal(s1.userModel.family, 'opus', 'the earliest-named family wins, not the ladder position');

  // A later prompt naming only Sonnet (or Haiku) must not overwrite the live
  // Opus grant — Sonnet is already the default and needs no grant of its own.
  prompt(home, repo, 'now run the sonnet-sized version of this too', { session_id: 's-order' });
  const s2 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-order.json'), 'utf8'));
  assert.equal(s2.userModel.family, 'opus', 'naming only sonnet leaves an existing opus grant untouched');
  assert.equal(s2.userModel.at, s1.userModel.at, 'the grant record itself is untouched, not just its family');
});

test('"router off" mutes the session; "router on" restores it; clear resets the card', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'router off', { session_id: 's-mute' });
  assert.equal(prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-mute' }), '');
  prompt(home, repo, 'router on', { session_id: 's-mute' });
  assert.match(prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-mute' }), /orchestrate is loaded/);

  run(home, { hook_event_name: 'SessionStart', source: 'clear', session_id: 's-mute', cwd: repo });
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions', 's-mute.json')), false);
});

test('the card carries no running total and no advice about the session settings', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const tr = join(repo, 't.jsonl');
  // A session on the "wrong" model and effort. The router used to tell it so.
  writeFileSync(tr, JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [] }, effort: 'low', entrypoint: 'claude-desktop' }));
  const out = prompt(home, repo, 'add a --json flag to status and test it', { session_id: 's-card', transcript_path: tr });
  assert.doesNotMatch(out, /you: sonnet|tier |orch-agents|codex:/, 'the proactive card carries none of it');
  assert.doesNotMatch(out, /your setup|belongs on|\/model|Effort → High/, 'and offers no opinion about it');
  assert.doesNotMatch(out, /\$\d|spent|total/);
  const status = prompt(home, repo, 'router status', { session_id: 's-card', transcript_path: tr });
  assert.match(status, /you: sonnet @ low effort/, 'router status still reports what it can see');
  assert.doesNotMatch(status, /your setup|belongs on|\/model|Effort → High/, 'and offers no opinion about it');
  assert.doesNotMatch(status, /\$\d|spent|total/);
});

test('malformed or missing input never fails', () => {
  const home = makeHome();
  for (const p of [{}, { hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'Nope', prompt: 'x' }]) {
    assert.equal(run(home, p), '');
  }
  const r = spawnSync(process.execPath, [ROUTER], { input: 'not json', encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0);
});

test('--state prints what it would inject and writes nothing', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const r = spawnSync(process.execPath, [ROUTER, '--state'], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: '' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[orchestrate\]/);
  assert.match(r.stdout, /card: \d+ characters/);
  assert.equal(existsSync(join(home, '.claude', 'orchestrate', 'sessions', 'cli.json')), false);
});

// ---- which task is ready ----------------------------------------------------
// A lead was watched waiting on one agent with a finished plan on the board and
// a `/goal` loop running, which is no progress and quota burning at once. It
// could not tell a ready task from a blocked one because the ledger had no
// column for the dependency. Now it does, and the router says so.

const NEW_HEADER = [
  '| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |',
  '|---|---|---|---|---|---|---|---|---|',
];
const taskRow = (id, phase, blocks = '—') =>
  `| ${id} | ${phase} | ${blocks} | src/${id}.ts | implementer · sonnet | do ${id} | exit 0 | 0 | — |`;

// Readiness and owed returns no longer print unasked — they are part of the
// full state line `router status` gives on request; the proactive flow only
// ever carries the one actionable sentence (a limit, a bound run, persist).

test('`router status` names the tasks that could start right now', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned'),
    taskRow('9-8-0003', '📋 planned', '9-8-0001'),
  ] });
  prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-ready' });
  const out = prompt(home, repo, 'router status', { session_id: 's-ready' });
  assert.match(out, /ready now: 9-8-0002/);
  assert.doesNotMatch(out, /9-8-0003/, 'a task whose blocker is still running is not ready');
});

test('the proactive flow says nothing about readiness, even when a task becomes ready', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned', '9-8-0001'),
  ] });
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');

  const first = prompt(home, repo, 'start on the tidy work please', { session_id: 's-change' });
  assert.doesNotMatch(first, /ready now/);
  assert.equal(prompt(home, repo, 'and how is that going now', { session_id: 's-change' }), '',
    'nothing changed, so nothing is said');

  // The blocker lands; readiness changed, but that is not one of the three
  // actionable facts, so the "changed" line stays silent.
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'anything else worth starting yet', { session_id: 's-change' });
  assert.doesNotMatch(after, /\[orchestrate · changed\]/);
  assert.doesNotMatch(after, /ready now/);

  const status = prompt(home, repo, 'router status', { session_id: 's-change' });
  assert.match(status, /ready now: 9-8-0002/, 'the fact is still there on request');
});

test('`router status` says what came back and is still waiting on you', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned'),
  ] });
  const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-8-0001', agent: 'orch-implementer', status: 'DONE' })}\n`);

  prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-owed' });
  const out = prompt(home, repo, 'router status', { session_id: 's-owed' });
  assert.match(out, /1 return to grade: 9-8-0001/, 'singular reads as English');
  assert.match(out, /ready now: 9-8-0002/, 'both facts fit on the one line');
});

test('the proactive flow never mentions an owed return, before or after it is graded', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [...NEW_HEADER, taskRow('9-8-0001', '🔨 running')] });
  const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
  const runMd = join(dir, 'RUN.md');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-8-0001', status: 'DONE' })}\n`);

  assert.doesNotMatch(prompt(home, repo, 'pick the tidy work back up please', { session_id: 's-owed2' }), /to grade/);
  assert.equal(prompt(home, repo, 'anything moved since then', { session_id: 's-owed2' }), '', 'still owed, still silent');

  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'right, what is outstanding now', { session_id: 's-owed2' });
  assert.doesNotMatch(after, /\[orchestrate · changed\]/);
  assert.doesNotMatch(after, /to grade/);
});

// ---- the brief: "What this is for" ------------------------------------------

test('sectionExcerpt is capped and section-ordered, and the brief reader reuses it', () => {
  const md = `## What this is for\n\n${'x'.repeat(BRIEF_CAP + 200)}\n`;
  const ex = sectionExcerpt(md, [{ pattern: /(?:^|\n)##\s+What this is for\b[ \t]*\n([\s\S]*?)(?:\n##\s|\s*$)/i }], BRIEF_CAP, { intro: false });
  assert.ok(ex.length <= BRIEF_CAP, `${ex.length} <= ${BRIEF_CAP}`);
  assert.match(ex, /^x+\.\.\.$/);
  // resumeExcerpt still orders Goal before Pickup, unchanged by the generalisation.
  const goalFirst = sectionExcerpt('## Pickup\n\ndo the thing\n\n## Goal\n\nship it\n', ['Goal', 'Pickup'], RESUME_CAP);
  assert.equal(goalFirst.indexOf('Goal:'), 0);
});

// briefState/briefNote's own tests (missing section, host-loaded, once-per-
// epoch, AGENTS.md) moved to lib/brief.test.mjs with the functions.

// ---- fresh-session handoff ---------------------------------------------------

test('the first substantive prompt stores it as the session goal, capped and collapsed', () => {
  const home = makeHome(); const repo = makeRepo(false);
  assert.equal(prompt(home, repo, 'ok'), '' , 'too short to be substantive');
  prompt(home, repo, '  add   a --json   flag\nto the status command  ', { session_id: 'sess-goal' });
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sess-goal.json'), 'utf8'));
  assert.equal(state.goal, 'add a --json flag to the status command');
  const before = state.goal;
  prompt(home, repo, 'a second substantive prompt in the same session', { session_id: 'sess-goal', prompt_id: 'p2' });
  const state2 = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 'sess-goal.json'), 'utf8'));
  assert.equal(state2.goal, before, 'the goal is set once, from the first substantive prompt only');
});

function seedSession(home, id, rec) {
  const dir = join(home, '.claude', 'orchestrate', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ v: 1, session_id: id, prompts: 1, cardSent: true, ...rec }));
}

test('a fresh session that says "continue" in the same folder gets the previous goal', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const lastSeen = new Date(Date.now() - 30 * 60000).toISOString();
  seedSession(home, 'sess-prev', { cwd: repo, goal: 'add a --json flag to the status command', lastSeen });
  const out = prompt(home, repo, 'continue', { session_id: 'sess-new' });
  assert.match(out, /Your last session in this folder, 30 minutes ago, was working on: "add a --json flag to the status command"\./);
  assert.match(out, /run `git status`/, 'no run and no checkpoint here, so the plain git-status clause');
});

test('a fresh session that asks "where were we?" (with the question mark) also gets the previous goal', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const lastSeen = new Date(Date.now() - 10 * 60000).toISOString();
  seedSession(home, 'sess-prev', { cwd: repo, goal: 'add a --json flag to the status command', lastSeen });
  const out = prompt(home, repo, 'where were we?', { session_id: 'sess-new' });
  assert.match(out, /Your last session in this folder, 10 minutes ago, was working on: "add a --json flag to the status command"\./);
});

test('a different cwd gets no handoff line', () => {
  const home = makeHome(); const repo = makeRepo(false); const other = makeRepo(false);
  const lastSeen = new Date(Date.now() - 5 * 60000).toISOString();
  seedSession(home, 'sess-prev', { cwd: other, goal: 'work on the other project', lastSeen });
  const out = prompt(home, repo, 'continue', { session_id: 'sess-new' });
  assert.doesNotMatch(out, /Your last session in this folder/);
});

test('a previous session older than 7 days gets no handoff line', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const lastSeen = new Date(Date.now() - 8 * 86400000).toISOString();
  seedSession(home, 'sess-prev', { cwd: repo, goal: 'stale work', lastSeen });
  const out = prompt(home, repo, 'continue', { session_id: 'sess-new' });
  assert.doesNotMatch(out, /Your last session in this folder/);
});

test('a second "continue" in the same session does not repeat the handoff line', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const lastSeen = new Date(Date.now() - 5 * 60000).toISOString();
  seedSession(home, 'sess-prev', { cwd: repo, goal: 'add a --json flag to the status command', lastSeen });
  const first = prompt(home, repo, 'continue', { session_id: 'sess-new' });
  assert.match(first, /Your last session in this folder/);
  const second = prompt(home, repo, 'continue', { session_id: 'sess-new', prompt_id: 'p2' });
  assert.doesNotMatch(second, /Your last session in this folder/);
});

// ---- the goal note ----------------------------------------------------------
const GOAL_LINE = /\[orchestrate · goal\] /;
function goalOf(out) { const m = /\[orchestrate · goal\] [^\n]*/.exec(out); return m ? m[0] : null; }
function writeNote(repo, text) {
  mkdirSync(join(repo, '.orchestrator'), { recursive: true });
  writeFileSync(join(repo, '.orchestrator', 'goal.md'), text);
}

test('the goal shows on the tenth prompt only, then ten later, and adds nothing between', () => {
  const home = makeHome(); const repo = makeRepo(false);
  writeNote(repo, 'Get the invoice export working for the accountant.\nShe can open the file in Excel.\n');
  const sid = 's-goal10';
  const outs = [];
  for (let i = 1; i <= 20; i++) outs.push(prompt(home, repo, `substantive request number ${i} about the invoice export`, { session_id: sid }));
  const shown = outs.map((o, i) => (GOAL_LINE.test(o) ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(shown, [10, 20]);
  const line = goalOf(outs[9]);
  assert.match(line, /Get the invoice export working for the accountant\. Done looks like: She can open the file in Excel\./);
  assert.match(line, /\(written (just now|\d+ min ago)\)$/);
  assert.ok(Buffer.byteLength(line) <= 350);
  assert.equal(outs[10], '', 'a prompt where nothing is due adds 0 bytes');
});

test('after a compaction with no run the goal text is printed, not only a path', () => {
  const home = makeHome(); const repo = makeRepo(false);
  writeNote(repo, 'Get the invoice export working.\nThe accountant can open it.\n');
  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-goalc', cwd: repo });
  assert.match(goalOf(out), /Get the invoice export working\. Done looks like: The accountant can open it\./);
});

test('after a compaction with no run and no note the first request is shown, labelled not confirmed', () => {
  const home = makeHome(); const repo = makeRepo(false);
  prompt(home, repo, 'add a --json flag to the status command and test it', { session_id: 's-goalf' });
  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-goalf', cwd: repo });
  assert.match(goalOf(out), /first request, not confirmed: add a --json flag/);
});

test('after a compaction with a run the goal is printed once, by the run excerpt, not twice', () => {
  const home = makeHome(); const repo = makeRepo(true);
  writeNote(repo, 'A note that the ledger outranks.\nDone.\n');
  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-goalr', cwd: repo });
  assert.equal(goalOf(out), null);
  assert.equal((out.match(/Finish the tidy command/g) || []).length, 1);
});

test('with nothing to show, a resume prints no goal line', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const out = run(home, { hook_event_name: 'SessionStart', source: 'resume', session_id: 's-goaln', cwd: repo });
  assert.equal(goalOf(out), null);
});

// One capacity for every card, and no reading from before the summary. The host
// runs this hook before it writes the compaction record, so a reading with no
// boundary in it is the pre-summary one.
function ctxTranscript(lines) {
  const p = join(mkdtempSync(join(tmpdir(), 'orch-ctx-t-')), 'session.jsonl');
  writeFileSync(p, lines.join(''));
  return p;
}
const usageLine = (n, id) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage: { input_tokens: 10, cache_read_input_tokens: n, cache_creation_input_tokens: 0, output_tokens: 5 } } }) + '\n';
const boundaryLine = uuid => JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date().toISOString(), compactMetadata: { preTokens: 150000, postTokens: 60000 } }) + '\n';

test('the size line after a compaction is not the reading from before it', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const t = ctxTranscript([usageLine(140000, 'm1')]);
  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-stale1', cwd: repo, transcript_path: t });
  assert.ok(!out.includes('[orchestrate · context]'), 'no boundary in the file yet: the 140k reading is stale');
});

test('the size line after a compaction prints no window the host did not report, and never a default', () => {
  const home = makeHome(); const repo = makeRepo(false);
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '180000' } }));
  const t = ctxTranscript([boundaryLine('b1'), usageLine(60000, 'm1')]);
  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: 's-cap1', cwd: repo, transcript_path: t });
  const line = /\[orchestrate · context\][^\n]*/.exec(out);
  assert.ok(line, 'a measured reading past the boundary is printed');
  assert.doesNotMatch(line[0], / of ~/, 'the setting is not a capacity: nothing is printed as the window');
  assert.doesNotMatch(line[0], /autocompact/);
});

