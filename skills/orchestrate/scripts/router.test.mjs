// router.test.mjs — what the context provider says, and the much larger set of
// things it no longer says.
//   node --test $(find skills -name '*.test.mjs')
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardBody, compactionFact, syntheticPrompt, CARD_CAP, resumeExcerpt, sectionExcerpt, RESUME_CAP, readyPhrase, ungradedPhrase, FALLBACK_CARD, stateLine, stateHash, briefState, briefNote, BRIEF_CAP, unreturned, unreturnedNote, CONTINUE_WORD, handoffLine } from './router.mjs';
import { AGENT_NAMES } from './lib/tier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTER = join(HERE, 'router.mjs');

test('state line and hash carry context bands', () => {
  const base = { self: null, tier: 'pro', agents: 0, limits: [], candidates: [], run: null, quota: null, persist: false };
  assert.match(stateLine({ ...base, context: { tokens: 151000 } }, '[x]'), /ctx ~151k/);
  assert.match(stateLine({ ...base, context: { tokens: 52000 } }, '[x]'), /ctx ~52k/, 'the measured size is always shown');
  assert.notEqual(stateHash({ ...base, context: { tokens: 121000 } }), stateHash({ ...base, context: { tokens: 151000 } }));
  assert.match(stateLine({ ...base, codex: 'limit', context: null }, '[x]'), /codex: limit/);
  assert.notEqual(stateHash({ ...base, codex: 'limit', context: null }), stateHash({ ...base, codex: 'ok', context: null }));
});

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'orch-home-'));
  mkdirSync(join(home, '.claude', 'orchestrate'), { recursive: true });
  writeFileSync(join(home, '.claude', 'orchestrate', 'profile.json'), JSON.stringify({ tier: 'max5', tierSource: 'user', setAt: '2026-09-08T00:00:00Z' }));
  // Most router tests are about ordinary prompts, not this one-time migration.
  writeFileSync(join(home, '.claude', 'orchestrate', 'autocompact-default.json'), '{}');
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  for (const n of AGENT_NAMES) {
    writeFileSync(join(home, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\n---\n`);
  }
  return home;
}

test('the first substantive router prompt offers auto-compact once, after the state line, and writes nothing', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, /Tip: this plugin works best with Claude Code's auto-compact set to 200k tokens\. Type `autocompact on`/);
  assert.equal(existsSync(join(home, '.claude', 'settings.json')), false, 'the offer alone never writes settings.json');
  const stateIdx = first.indexOf('[orchestrate]');
  const tipIdx = first.indexOf('Tip: this plugin works best');
  assert.ok(stateIdx >= 0 && tipIdx > stateIdx, 'the tip comes after the state line, not before it');
  assert.equal(prompt(home, repo, 'another substantive prompt goes here too'), '', 'the marker makes later prompts cheap and silent, offer or not');
});

test('a non-substantive first prompt does not spend the one-time offer', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const marker = join(home, '.claude', 'orchestrate', 'autocompact-default.json');
  unlinkSync(marker);
  assert.equal(prompt(home, repo, 'ok'), '', 'too short to be substantive, so no tip and no marker spent');
  assert.equal(existsSync(marker), false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, /Tip: this plugin works best/, 'the tip still arrives on the first substantive prompt');
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
    env: { ...process.env, USERPROFILE: home, HOME: home, ANTHROPIC_API_KEY: '', CLAUDE_EFFORT: '' },
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

test('the first substantive prompt gets the state line and the card, once', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const first = prompt(home, repo, 'add a --json flag to the status command and test it');
  assert.match(first, /\[orchestrate\]/);
  assert.match(first, /tier max5/);
  assert.match(first, new RegExp(`orch-agents ${AGENT_NAMES.length}/${AGENT_NAMES.length}`));
  assert.match(first, /run: none/);
  assert.match(first, /orchestrate is loaded/);

  const second = prompt(home, repo, 'now do the same for the list command and test that too');
  assert.equal(second, '', 'nothing changed, so there is nothing to say');
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
    const out = prompt(home, repo, m, { session_id: 's-quiet' });
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
  assert.match(after, /\[orchestrate · changed\]/);
  assert.match(after, /limits today: opus/);
});

test('an open run is named, and its goal comes with it', () => {
  const home = makeHome(); const repo = makeRepo(true);
  const first = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-run' });
  assert.match(first, /run: 20260908-tidy-finish/);
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
  assert.match(compactionFact({ dispatches: [] }), /0 helpers sent so far; orch-advisor last sent: never\./);
  assert.match(compactionFact({ dispatches: [{ agent: 'orch-advisor' }] }), /1 helper sent so far; orch-advisor last sent: the most recent helper\./);
});

test('SessionStart compact with no bound run injects the checkpoint file, capped at 1,200 chars', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const sessionId = 's-checkpoint1';
  const dir = join(home, '.claude', 'orchestrate', 'context', sessionId);
  mkdirSync(dir, { recursive: true });
  const long = 'checkpoint text '.repeat(200); // well over the 1,200 char cap
  writeFileSync(join(dir, 'checkpoint-e1.md'), long);

  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sessionId, cwd: repo });
  const m = /\[orchestrate · compacted\] checkpoint\n([\s\S]*)/.exec(out);
  assert.ok(m, `expected a checkpoint block: ${out}`);
  const excerpt = m[1];
  assert.ok(excerpt.length <= 1200, `${excerpt.length} <= 1200`);
  assert.match(excerpt, /\.\.\.$/);
  assert.equal(excerpt, `${long.slice(0, 1197)}...`);
});

test('the resume excerpt is bounded', () => {
  const repo = makeRepo(true);
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');
  const long = readFileSync(runMd, 'utf8').replace('Finish the tidy command so notes stop piling up.', 'x '.repeat(5000));
  writeFileSync(runMd, long);
  const ex = resumeExcerpt(runMd);
  assert.ok(ex.length <= RESUME_CAP, `${ex.length} <= ${RESUME_CAP}`);
  assert.match(ex, /\.\.\.$/);
});

test('a bullet crossing the cap is cut at the line boundary before it, never mid-word (bug: was a raw character cut)', () => {
  const repo = makeRepo(true);
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');
  // A "not doing" bullet long enough that RESUME_CAP lands inside one of its
  // words, the shape observed live: the run card came back truncated at
  // "not doing: rewriting SKILL.md body wholesale in wave..." mid-word.
  const bullet = `- not doing: rewriting SKILL.md body wholesale in wave two, since that would blow the token budget for this one task and leave nothing for the ${'x'.repeat(2000)} rest`;
  const runMdText = readFileSync(runMd, 'utf8').replace(
    '- constraint: the never-delete rule holds',
    `- constraint: the never-delete rule holds\n${bullet}`,
  );
  writeFileSync(runMd, runMdText);

  // Reproduce first: the old raw cut landed inside a run of "x"s (mid-word).
  const rawCut = runMdText
    .split('## Constraints and non-goals\n\n')[1].split('\n\n## Approach')[0]
    .split('\n').filter(l => l.trim()).join('\n');
  const budget = RESUME_CAP - 3;
  // Sanity: the raw slice used to land inside a word (a run of "x"s), which is
  // exactly the bug — confirms this fixture reproduces it before the fix is
  // trusted to have changed anything.
  assert.match(rawCut.slice(budget - 5, budget + 5), /xxxxxxxxxx/, 'fixture must actually cross mid-word under a raw cut');

  const ex = resumeExcerpt(runMd);
  assert.ok(ex.length <= RESUME_CAP, `${ex.length} <= ${RESUME_CAP}`);
  assert.match(ex, /\.\.\.$/);
  // The excerpt must end at a full line (the bullet before the giant one), not
  // mid-word inside the run of "x"s.
  assert.doesNotMatch(ex, /x{2,}\.\.\.$/);
  assert.match(ex, /rule holds\.\.\.$/, `expected the cut to fall back to the previous bullet's line boundary, got: ${JSON.stringify(ex.slice(-60))}`);
});

test('sectionExcerpt cuts at a sentence boundary, never mid-word', () => {
  const body = 'The approach keeps changes small. Not doing: rewriting SKILL.md body wholesale in wave two, since that would blow the budget for this task entirely.';
  const md = `## Approach\n\n${body}\n`;
  const wordStart = body.indexOf('wholesale');
  const cap = wordStart + 5 + 3; // lands mid-word under the old raw cut ("whol|esale")
  const rawCut = body.slice(0, cap - 3);
  assert.match(rawCut, /whole$/, 'fixture must cross mid-word under a raw cut');

  const ex = sectionExcerpt(md, ['Approach'], cap);
  assert.ok(ex.length <= cap, `${ex.length} <= ${cap}`);
  assert.match(ex, /\.\.\.$/);
  // Falls back to the last sentence boundary before the cap: "...small."
  assert.equal(ex, 'Approach: The approach keeps changes small....');
});

test('checkpointExcerpt cuts at the last newline before the cap, never mid-word', () => {
  const home = makeHome(); const repo = makeRepo(false);
  const sessionId = 's-checkpoint2';
  const dir = join(home, '.claude', 'orchestrate', 'context', sessionId);
  mkdirSync(dir, { recursive: true });
  // Short lines so a newline boundary sits well before the raw cut point.
  const lines = [];
  for (let i = 0; i < 60; i++) lines.push(`line ${i}: some notes about the work done so far, nothing longer`);
  const long = lines.join('\n');
  writeFileSync(join(dir, 'checkpoint-e1.md'), long);

  const out = run(home, { hook_event_name: 'SessionStart', source: 'compact', session_id: sessionId, cwd: repo });
  const m = /\[orchestrate · compacted\] checkpoint\n([\s\S]*)/.exec(out);
  assert.ok(m, `expected a checkpoint block: ${out}`);
  const excerpt = m[1];
  assert.ok(excerpt.length <= 1200, `${excerpt.length} <= 1200`);
  assert.match(excerpt, /\.\.\.$/);
  // Raw cut at 1197 chars would land inside a line; confirm the fixture
  // reproduces that before checking the fix.
  assert.doesNotMatch(long.slice(1194, 1200), /\n/, 'fixture must cross mid-line under a raw cut');
  // The fix cuts back to the end of the last whole line before the cap.
  const lastFullLine = long.slice(0, 1197).split('\n').slice(0, -1).join('\n');
  assert.equal(excerpt, `${lastFullLine}...`);
});

test('unreturned excludes a dispatch runningNative still counts as alive, and softens the wording for the rest', () => {
  const state = {
    dispatches: [
      { agent: 'orch-implementer', task: '9-1-0001', at: '2026-09-01T00:00:00Z' },
      { agent: 'orch-researcher', task: '9-1-0002', at: '2026-09-01T00:05:00Z' },
    ],
    returned: [],
  };
  // runningNative still sees 9-1-0001 as alive; it has nothing to say about
  // 9-1-0002 (it may be alive too — runningNative just can't tell from here).
  const native = [{ provider: 'claude', role: 'orch-implementer', task: '9-1-0001', at: state.dispatches[0].at, agentId: 'a1', parent: null }];

  const list = unreturned(state, { native });
  assert.equal(list.length, 1, 'the one runningNative still sees alive is excluded');
  assert.equal(list[0].task, '9-1-0002');

  const note = unreturnedNote(state, { native });
  assert.match(note, /9-1-0002/);
  assert.doesNotMatch(note, /9-1-0001/, 'the still-alive dispatch is not listed');
  // Softened wording: not a settled "never returned" verdict.
  assert.doesNotMatch(note, /never returned/i);
  assert.match(note, /no return seen/i);

  // With no runningNative cross-check at all, both are still listed (the
  // check only narrows the list; it is not required for the note to fire).
  const noteNoNative = unreturnedNote(state);
  assert.match(noteNoNative, /9-1-0001/);
  assert.match(noteNoNative, /9-1-0002/);
});

test('a single unambiguous open run binds itself; two do not', () => {
  const home = makeHome(); const repo = makeRepo(true);
  prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-bind' });
  const state = JSON.parse(readFileSync(join(home, '.claude', 'orchestrate', 'sessions', 's-bind.json'), 'utf8'));
  assert.equal(state.run.runId, '20260908-tidy-finish', 'a hook that writes now has an association');

  const second = join(repo, '.orchestrator', 'runs', '20260909-other');
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, 'RUN.md'), '# Run\n\n## Tasks\n\n| id | p | r | t | u | a | e |\n|---|---|---|---|---|---|---|\n| 9-9-0001 | 🔨 running | x | y | z | 0 | — |\n');
  const out = prompt(home, repo, 'start on the second piece of work now please', { session_id: 's-bind2' });
  assert.match(out, /2 candidates/);
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
  assert.match(under, /candidate, not bound/);
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
  assert.match(out, /run: none/);
  assert.doesNotMatch(out, /candidate/);
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
  assert.match(out, /you: sonnet @ low effort/, 'it still reports what it can see');
  assert.doesNotMatch(out, /your setup|belongs on|\/model|Effort → High/, 'and offers no opinion about it');
  assert.doesNotMatch(out, /\$\d|spent|total/);
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

test('the card body stays inside the cap it names', () => {
  // Every character is paid on every later turn of the session that got it.
  const body = cardBody();
  assert.ok(body.length <= CARD_CAP, `card is ${body.length} characters, cap ${CARD_CAP}`);
  // It comes from ladder.md, so the text has one home.
  const ladder = readFileSync(join(HERE, '..', 'references', 'ladder.md'), 'utf8');
  assert.ok(ladder.includes(body), 'the card is the fenced block in ladder.md, verbatim');
  assert.match(body, /router off/, 'it says how to turn itself off');
});

test('the fallback card cannot silently drift from the real one', () => {
  // FALLBACK_CARD only runs when ladder.md cannot be read, so nothing else
  // exercises it; it drifted two paragraphs behind the real card once already.
  const ladder = readFileSync(join(HERE, '..', 'references', 'ladder.md'), 'utf8');
  assert.ok(ladder.includes(FALLBACK_CARD), 'FALLBACK_CARD is byte-identical to the fenced block in ladder.md');
  assert.ok(FALLBACK_CARD.length <= CARD_CAP, `fallback card is ${FALLBACK_CARD.length} characters, cap ${CARD_CAP}`);
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

test('the run line names the tasks that could start right now', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned'),
    taskRow('9-8-0003', '📋 planned', '9-8-0001'),
  ] });
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-ready' });
  assert.match(out, /ready now: 9-8-0002/);
  assert.doesNotMatch(out, /9-8-0003/, 'a task whose blocker is still running is not ready');
});

test('a legacy ledger says nothing about readiness rather than guessing', () => {
  const home = makeHome();
  const repo = makeRepo(true);
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-legacy' });
  assert.match(out, /run: 20260908-tidy-finish/);
  assert.doesNotMatch(out, /ready now/, 'the old table has no edges to read');
});

test('a run with nothing planned says nothing about readiness', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [...NEW_HEADER, taskRow('9-8-0001', '🔨 running')] });
  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-none' });
  assert.doesNotMatch(out, /ready now/);
});

test('a task becoming ready reprints the line; an unchanged board stays quiet', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [
    ...NEW_HEADER,
    taskRow('9-8-0001', '🔨 running'),
    taskRow('9-8-0002', '📋 planned', '9-8-0001'),
  ] });
  const runMd = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish', 'RUN.md');

  const first = prompt(home, repo, 'start on the tidy work please', { session_id: 's-change' });
  assert.doesNotMatch(first, /ready now/, 'nothing is ready while the blocker runs');
  assert.equal(prompt(home, repo, 'and how is that going now', { session_id: 's-change' }), '',
    'nothing changed, so nothing is said');

  // The blocker lands. That is the moment the lead has something better to do
  // than wait, and the moment the line is worth its tokens.
  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'anything else worth starting yet', { session_id: 's-change' });
  assert.match(after, /\[orchestrate · changed\]/);
  assert.match(after, /ready now: 9-8-0002/);

  assert.equal(prompt(home, repo, 'right, carrying on with that then', { session_id: 's-change' }), '',
    'and it says it once, not every turn');
});

test('a long ready list is trimmed rather than filling the line', () => {
  const ready = Array.from({ length: 9 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = readyPhrase({ ready });
  assert.match(phrase, /ready now: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+5 more/);
  assert.ok(phrase.length < 80, `${phrase.length} characters is small enough to print every turn`);
  assert.equal(readyPhrase({ ready: [] }), '');
  assert.equal(readyPhrase(null), '');
});

test('the run line says what came back and is still waiting on you', () => {
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

  const out = prompt(home, repo, 'carry on with the tidy work from yesterday', { session_id: 's-owed' });
  assert.match(out, /1 return to grade: 9-8-0001/, 'singular reads as English');
  assert.match(out, /ready now: 9-8-0002/, 'both facts fit on the one line');
});

test('setting the row stops the reminder, and that counts as a state change', () => {
  const home = makeHome();
  const repo = makeRepo(true, { rows: [...NEW_HEADER, taskRow('9-8-0001', '🔨 running')] });
  const dir = join(repo, '.orchestrator', 'runs', '20260908-tidy-finish');
  const runMd = join(dir, 'RUN.md');
  mkdirSync(join(dir, 'returns'), { recursive: true });
  writeFileSync(join(dir, 'returns', 'returns.jsonl'),
    `${JSON.stringify({ task: '9-8-0001', status: 'DONE' })}\n`);

  assert.match(prompt(home, repo, 'pick the tidy work back up please', { session_id: 's-owed2' }), /1 return to grade/);
  assert.equal(prompt(home, repo, 'anything moved since then', { session_id: 's-owed2' }), '', 'still owed, still silent');

  writeFileSync(runMd, readFileSync(runMd, 'utf8').replace('| 9-8-0001 | 🔨 running |', '| 9-8-0001 | ✅ done |'));
  const after = prompt(home, repo, 'right, what is outstanding now', { session_id: 's-owed2' });
  assert.match(after, /\[orchestrate · changed\]/);
  assert.doesNotMatch(after, /to grade/, 'it has been judged, so it stops asking');
});

test('a long list of owed returns is trimmed like the ready one', () => {
  const ungraded = Array.from({ length: 7 }, (_, i) => `9-8-000${i + 1}`);
  const phrase = ungradedPhrase({ ungraded });
  assert.match(phrase, /7 returns to grade: 9-8-0001, 9-8-0002, 9-8-0003, 9-8-0004 \+3 more/);
  assert.equal(ungradedPhrase({ ungraded: [] }), '');
  assert.equal(ungradedPhrase(null), '');
});

// ---- the brief: "What this is for" ------------------------------------------

function makeBriefRepo({ file = 'CLAUDE.md', body = '## What this is for\n\nMakes toast, for people in a hurry.\n\nDeciding documents (these win when the code and the intent disagree):\n- docs/roadmap.md — where we are\n' } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'orch-brief-repo-'));
  mkdirSync(join(repo, '.git'), { recursive: true });
  if (file) {
    const p = join(repo, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return repo;
}

test('sectionExcerpt is capped and section-ordered, and the brief reader reuses it', () => {
  const md = `## What this is for\n\n${'x'.repeat(BRIEF_CAP + 200)}\n`;
  const ex = sectionExcerpt(md, [{ pattern: /(?:^|\n)##\s+What this is for\b[ \t]*\n([\s\S]*?)(?:\n##\s|\s*$)/i }], BRIEF_CAP, { intro: false });
  assert.ok(ex.length <= BRIEF_CAP, `${ex.length} <= ${BRIEF_CAP}`);
  assert.match(ex, /^x+\.\.\.$/);
  // resumeExcerpt still orders Goal before Pickup, unchanged by the generalisation.
  const goalFirst = sectionExcerpt('## Pickup\n\ndo the thing\n\n## Goal\n\nship it\n', ['Goal', 'Pickup'], RESUME_CAP);
  assert.equal(goalFirst.indexOf('Goal:'), 0);
});

test('a missing brief section prints one fact line, once', () => {
  const repo = makeBriefRepo({ file: 'CLAUDE.md', body: '# Just some notes\n\nNo section here.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  const first = briefNote(ctx, state);
  assert.match(first, /\[orchestrate · brief\] no "What this is for" section between/);
  assert.match(first, /Template: .*assets[\\/]BRIEF\.md/);
  assert.equal(briefNote(ctx, state), '', 'said once per session');
});

test('a brief the host loads prints nothing', () => {
  const repo = makeBriefRepo();
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  assert.equal(briefState(ctx, state).kind, 'kept');
  assert.equal(briefNote(ctx, state), '');
});

test('a brief the host does not keep in view is printed once per epoch and again after a compaction', () => {
  const repo = makeBriefRepo();
  // No repoRoot: the session was started above the project, and the working
  // project is known only from touched paths (context-check.mjs's state.work).
  const ctx = { repoRoot: null, cwd: null, run: null };
  const state = { work: { root: repo, dir: repo, counts: {} } };
  const b = briefState(ctx, state);
  assert.equal(b.kind, 'other');
  const first = briefNote(ctx, state);
  assert.match(first, /\[orchestrate · brief\] from .*CLAUDE\.md/);
  assert.match(first, /Makes toast/);
  assert.equal(briefNote(ctx, state), '', 'once per epoch');
  // A compaction is a new epoch: the router forces it, whatever was said before.
  const again = briefNote(ctx, state, { force: true });
  assert.match(again, /Makes toast/);
});

test('the brief section is found in AGENTS.md', () => {
  const repo = makeBriefRepo({ file: 'AGENTS.md', body: '## What this is for\n\nRuns the payroll for one small shop.\n' });
  const ctx = { repoRoot: repo, cwd: repo, run: null };
  const state = {};
  const b = briefState(ctx, state);
  assert.match(b.file, /AGENTS\.md$/);
  assert.match(b.text, /Runs the payroll/);
  // A bare AGENTS.md nobody pulls in with @AGENTS.md is not kept in view.
  assert.equal(b.kind, 'other');
});

// ---- fresh-session handoff ---------------------------------------------------

test('CONTINUE_WORD matches only the whole trimmed prompt', () => {
  for (const w of ['continue', 'keep going', 'resume', 'pick up where we left off', 'where were we', "what's next", 'whats next', 'carry on', 'CONTINUE', ' Resume ']) {
    assert.ok(CONTINUE_WORD.test(w.trim()), w);
  }
  assert.equal(CONTINUE_WORD.test('continue adding tests'), false);
  assert.equal(CONTINUE_WORD.test('should I continue'), false);
});

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

test('handoffLine names a written Pickup section over plain git status', () => {
  const runMd = join(mkdtempSync(join(tmpdir(), 'orch-run-')), 'RUN.md');
  writeFileSync(runMd, '## Pickup\n\nPickup prompt: dispatch the next task\nPickup confidence: high\n');
  const ctx = { run: { runMd } };
  const line = handoffLine({ goal: 'ship the login page', lastSeen: new Date(Date.now() - 60000).toISOString() }, ctx);
  assert.match(line, /Pickup section of/);
  assert.doesNotMatch(line, /git status/);
});

test('handoffLine falls back to git status when there is no run or checkpoint', () => {
  const line = handoffLine({ goal: 'ship the login page', session_id: 'no-such-session', lastSeen: new Date(Date.now() - 60000).toISOString() }, { run: null });
  assert.match(line, /run `git status`/);
});
