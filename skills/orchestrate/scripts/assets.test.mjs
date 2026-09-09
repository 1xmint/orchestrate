// assets.test.mjs — the shipped markdown has to keep its frontmatter contract.
// These are cheap checks that catch drift a human edit would introduce.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_NAMES } from './lib/tier.mjs';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = join(SKILL, 'assets', 'agents');

const frontmatter = text => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'the file starts with frontmatter');
  return m[1];
};

test('all six role agents ship, and each names itself', () => {
  const files = readdirSync(AGENTS).filter(f => f.endsWith('.md'));
  assert.equal(files.length, 6);
  for (const f of files) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    assert.match(fm, new RegExp(`^name: ${f.replace(/\.md$/, '')}$`, 'm'));
    assert.ok(AGENT_NAMES.includes(f.replace(/\.md$/, '')), `${f} is in AGENT_NAMES`);
  }
});

test('every role agent carries the return check as its own Stop hook', () => {
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    assert.match(fm, /^hooks:$/m, f);
    assert.match(fm, /^ {2}Stop:$/m, f);
    // One token both install paths understand: a plugin expands
    // ${CLAUDE_PLUGIN_ROOT} itself, and install.mjs replaces the whole prefix
    // with wherever the skill landed. No build step either way.
    assert.match(fm, /command: 'node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/orchestrate\/scripts\/return-check\.mjs"'/, f);
    assert.ok(existsSync(join(SKILL, 'scripts', 'return-check.mjs')), 'the script the hook names exists');
  }
});

test('memory is on the two roles that gain from it, and off the two that would be steered by it', () => {
  const has = n => /^memory: user$/m.test(readFileSync(join(AGENTS, `${n}.md`), 'utf8'));
  assert.ok(has('orch-reviewer'), 'a reviewer should remember repo standards');
  assert.ok(has('orch-researcher'), 'a researcher should remember sources');
  assert.ok(!has('orch-implementer'), 'a stale note must not steer a change');
  assert.ok(!has('orch-debugger'), 'a stale note must not steer a diagnosis');
});

test('read-only roles keep read-only tool sets', () => {
  const tools = n => (/^tools: (.+)$/m.exec(readFileSync(join(AGENTS, `${n}.md`), 'utf8')) || [])[1] || '';
  for (const n of ['orch-reviewer', 'orch-planner', 'orch-researcher']) {
    const t = tools(n);
    assert.ok(t, `${n} declares a tool set`);
    assert.doesNotMatch(t, /\bEdit\b|\bNotebookEdit\b/, `${n} cannot edit`);
    // The planner and the researcher write exactly one document each; the
    // reviewer writes nothing at all, which is what makes its verdict worth
    // reading.
    if (n === 'orch-reviewer') assert.doesNotMatch(t, /\bWrite\b/, 'a reviewer cannot write');
  }
});

test('the placeholder is only ever {{SKILL_DIR}}, never a machine path', () => {
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(AGENTS, f), 'utf8');
    assert.doesNotMatch(text, /C:\\Users|\/Users\/[a-z]+\/|\/home\/[a-z]+\//i, `${f} carries no machine path`);
  }
});

// The eval file is the input to the skill-creator loop. It was never run, and
// it turned out it could not be: the Windows path in eval 2 was written with
// unescaped backslashes, so the file was not valid JSON at all.
test('evals.json parses, and every eval carries the fields the loop needs', () => {
  const p = join(SKILL, '..', '..', 'evals', 'evals.json');
  const raw = readFileSync(p, 'utf8');
  const doc = JSON.parse(raw); // this threw before the fix
  assert.equal(doc.skill_name, 'orchestrate');
  assert.ok(Array.isArray(doc.evals) && doc.evals.length >= 3);
  const ids = new Set();
  for (const e of doc.evals) {
    for (const k of ['id', 'name', 'prompt', 'expected_output']) assert.ok(e[k], `eval ${e.id} has ${k}`);
    assert.ok(!ids.has(e.id), `eval id ${e.id} is unique`);
    ids.add(e.id);
    assert.match(e.name, /^[a-z0-9-]+$/);
  }
});

test('no eval hard-codes one machine, so the file runs on any checkout', () => {
  const raw = readFileSync(join(SKILL, '..', '..', 'evals', 'evals.json'), 'utf8');
  assert.doesNotMatch(raw, /C:\\Users|\/Users\/[a-z]+\/|\/home\/[a-z]+\//i);
  assert.match(raw, /\{\{FIXTURE_[A-Z]+\}\}/, 'fixtures are named by placeholder');
});

// The packet template is what a dispatch actually reads; contracts.md is the
// 11 KB explanation behind it. They must not drift apart.
test('assets/packet.md carries every field contracts.md documents', () => {
  const packet = readFileSync(join(SKILL, 'assets', 'packet.md'), 'utf8');
  const contracts = readFileSync(join(SKILL, 'references', 'contracts.md'), 'utf8');
  const fields = ['TASK:', 'OBJECTIVE', 'DONE WHEN', 'NOT IN SCOPE', 'FACTS', 'GATE',
    'VERIFY LIVE BEFORE ACTING', 'DECISIONS ALREADY MADE', 'WHERE', 'PARALLEL',
    'PRIOR ATTEMPTS', 'PATTERNS TO FOLLOW', 'SKILLS TO USE', 'VERIFICATION COMMANDS',
    'DURABILITY', 'STOP AND REPORT', 'BUDGET', 'RETURN', 'RESTATED:', 'STATUS:', 'EVIDENCE:'];
  for (const f of fields) {
    assert.ok(packet.includes(f), `packet.md has ${f}`);
    assert.ok(contracts.includes(f), `contracts.md has ${f}`);
  }
  assert.ok(packet.includes('ROLE: reviewer'), 'the reviewer packet is here too');
  assert.ok(packet.includes('VERDICT: PASS|FAIL'), 'with the one schema');
  assert.ok(packet.length < 6000, `packet.md is ${packet.length} bytes; it exists to be small`);
});

// The Fable cap was removed because a count answers the wrong question and
// reads as an allowance. Prose is where it would creep back, so prose is where
// this checks.
test('no shipped file states a numeric Fable allowance', () => {
  const files = [
    join(SKILL, 'SKILL.md'),
    ...readdirSync(join(SKILL, 'references')).map(f => join(SKILL, 'references', f)),
    ...readdirSync(AGENTS).map(f => join(AGENTS, f)),
    join(SKILL, 'assets', 'packet.md'),
  ].filter(p => p.endsWith('.md'));

  for (const p of files) {
    const text = readFileSync(p, 'utf8');
    const name = p.split(/[\/]/).pop();
    for (const line of text.split('\n')) {
      if (!/fable/i.test(line)) continue;
      // A line saying the cap is gone is the opposite of the drift, not it.
      if (/was removed|used to|no longer|there used to be/i.test(line)) continue;
      assert.doesNotMatch(line, /\bcap(ped|s)?\b/i, `${name}: ${line.trim().slice(0, 90)}`);
      assert.doesNotMatch(line, /\d+\s*(a day|per day|\/day|dispatches a day)/i, `${name}: ${line.trim().slice(0, 90)}`);
      assert.doesNotMatch(line, /fable-optin|opts? in for the day/i, `${name}: ${line.trim().slice(0, 90)}`);
    }
  }
});

// Prose wraps. A sentence that has to survive is asserted against the file with
// its line breaks flattened, so reflowing a paragraph never fails a test that
// is about what the paragraph says.
const flat = s => s.replace(/\s+/g, ' ');

test('the skill tells the manager to ask when a model is not in the plan', () => {
  const skill = flat(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'));
  const routing = flat(readFileSync(join(SKILL, 'references', 'routing.md'), 'utf8'));
  assert.match(skill, /Never downgrade quietly to avoid asking, and never spend quietly/);
  assert.match(routing, /the choice is theirs, not yours/);
  assert.match(routing, /When Fable earns its cost/);
});

test('the skill carries the money rule with a number in it', () => {
  const skill = flat(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'));
  const routing = flat(readFileSync(join(SKILL, 'references', 'routing.md'), 'utf8'));
  // A rule without a number is a wish. These are the two thresholds.
  assert.match(skill, /Over about 5% of a week, say the price in one line/);
  assert.match(skill, /over about 25%, ask first with the recommendation in front of the question/);
  assert.match(routing, /Say the price before you spend/);
  assert.match(routing, /Never a running total in the conversation/);
});

test('the run ledger asks why the run is not smaller', () => {
  const run = readFileSync(join(SKILL, 'assets', 'RUN.md'), 'utf8');
  assert.match(run, /^## Shape$/m);
  assert.match(run, /why not smaller/);
  assert.match(flat(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')), /Fill the `Shape` line before the first dispatch/);
});

// Each of these is a rule with a test inside it, not a wish. A wish ("be
// clear") survives any rewrite; a test ("ask what happens if they ignore it")
// is what actually changes an output.
// Case-insensitive: the same rule opens a bullet in one file and a sentence in
// the other. What has to match is the rule, not its capital letter.
// The six rules that must survive with the style turned off, so SKILL.md §9 and
// the style are checked against the same list. The style says more than this;
// §9 is deliberately the short version, because a longer §9 competes with the
// style rather than backing it up.
const SPEECH_RULES = [
  // The two that matter most to the person on the other end, and the two the
  // skill did not say at all until a user pointed out that it was agreeing with
  // him instead of engineering for him.
  /Find out what they actually want/i,
  /Agreement is not a deliverable/i,
  /Lead with the answer/i,
  /what is from memory/i,
  /Deliver what was asked, at the scope intended/i,
  /what happened, then the evidence with paths/i,
  /never for the evidence/i,
  /ask what\s+happens if they ignore it/i,
];

test('SKILL.md carries the plain-speech rules, each with its own test', () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /How to talk to the user/);
  assert.match(skill, /fifteen and sharp/);
  assert.match(skill, /Simplify the words, never the facts/, 'plain is not dumbed down');
  for (const r of SPEECH_RULES) assert.match(skill, r, String(r));
});

test('the Plain output style ships, is valid, and says the same thing as §9', () => {
  const p = join(SKILL, 'assets', 'output-styles', 'plain.md');
  assert.ok(existsSync(p), 'assets/output-styles/plain.md ships with the skill');
  const style = readFileSync(p, 'utf8');
  const fm = frontmatter(style);

  assert.match(fm, /^name: Plain$/m);
  assert.match(fm, /^description: \S/m, 'the /config picker shows the description');
  // Without this the style would drop Claude Code's engineering instructions,
  // which is right for a writing assistant and wrong for an orchestrator.
  assert.match(fm, /^keep-coding-instructions: true$/m);
  // Josh's decision, 2026-09-09: installed as a plugin, the voice is on without
  // anybody choosing it, and disabling the plugin is the way off.
  assert.match(fm, /^force-for-plugin: true$/m);

  for (const r of SPEECH_RULES) assert.match(style, r, `the style and §9 agree on ${r}`);

  // Anthropic's own Opus 5 scope paragraph, verbatim. It is what stops a model
  // that verifies its own work anyway from expanding the task while it does so.
  // Compared with the line wrapping flattened, so reflowing the file is free.
  const flat = style.replace(/\s+/g, ' ');
  assert.match(flat, /Make routine judgment calls yourself, and check in only when different readings of the request would lead to materially different work\./);
  assert.match(flat, /Finish the whole task, and stop short of actions that are clearly beyond what was asked\./);

  // The two verification lines point opposite ways on purpose: one stops Opus 5
  // re-proving what it already proved, the other stops a low-effort model
  // answering a current fact from memory. Neither asks for more self-checking.
  assert.match(style, /A name you recognise is not a fact you know/);
  assert.doesNotMatch(style, /double-check|re-verify|verify (your|it) again/i,
    'never an instruction to re-check its own work: that is the one thing both model guides forbid');

  assert.ok(Buffer.byteLength(style) <= 4500, `the style is ${Buffer.byteLength(style)} bytes, cap 4500`);
});

test('the installer copies the output style but never selects it', () => {
  const installer = readFileSync(join(SKILL, '..', '..', 'scripts', 'install.mjs'), 'utf8');
  assert.match(installer, /output-styles/);
  // Selecting a style rewrites the system prompt for every session the user
  // has. That is their call, so the installer prints the line and stops.
  assert.doesNotMatch(installer, /writeSettings\([^)]*outputStyle|settings\.outputStyle\s*=/);
  assert.match(installer, /"outputStyle": "Plain"/, 'it shows them the one line to add');
});

// The plugin manifest is the one-command install path. If it points at a
// directory that moved, the plugin installs and quietly does nothing.
test('the plugin manifest points at files that exist, and agrees with the skill', () => {
  const root = join(SKILL, '..', '..');
  const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'orchestrate', 'kebab-case, no spaces; it is the install id');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

  // `agents` takes a list of files, not a directory. It held a directory string
  // for three releases and `claude plugin validate` rejected the whole
  // manifest, which is one of the two reasons the advertised one-command
  // install had never worked for anybody.
  assert.ok(Array.isArray(manifest.agents), 'agents is a list of files');
  assert.equal(manifest.agents.length, AGENT_NAMES.length);
  for (const rel of manifest.agents) assert.ok(existsSync(join(root, rel)), `${rel} exists`);
  // outputStyles lives outside the default scan, so it has to be declared.
  assert.ok(typeof manifest.outputStyles === 'string' && existsSync(join(root, manifest.outputStyles)),
    `outputStyles -> ${manifest.outputStyles} exists`);
  // `hooks` must NOT be declared. hooks/hooks.json is loaded automatically, and
  // naming it as well made the host refuse the whole plugin with "Duplicate
  // hooks file detected". The manifest key is only for ADDITIONAL hook files.
  assert.equal(manifest.hooks, undefined, 'hooks/hooks.json loads on its own');
  assert.ok(existsSync(join(root, 'hooks', 'hooks.json')), 'and it is where the host looks');
  // skills/ is scanned by default, so the skill needs no entry, but it does
  // need to be where a plugin host looks for it.
  assert.ok(existsSync(join(root, 'skills', 'orchestrate', 'SKILL.md')));
  assert.equal(manifest.skills, undefined, 'the default skills/ scan already finds it');
});

// The other reason the one-command install never worked: the README told people
// to add this repo as a marketplace and there was no marketplace manifest in it
// at all, so the command they were given could only fail.
test('the repo is a marketplace, and it points at itself', () => {
  const root = join(SKILL, '..', '..');
  const p = join(root, '.claude-plugin', 'marketplace.json');
  assert.ok(existsSync(p), 'the README tells people to add this repo as a marketplace');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(m.name, 'orchestrate');
  assert.ok(m.owner && m.owner.name, 'a marketplace names its owner');
  assert.ok(Array.isArray(m.plugins) && m.plugins.length === 1);

  const entry = m.plugins[0];
  assert.equal(entry.name, 'orchestrate', 'this is the install id users type');
  assert.equal(entry.source, './', 'the plugin is the repository root');

  // A version that disagrees with plugin.json decides who gets an update, so
  // the two must move together.
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(entry.version, plugin.version, 'marketplace and plugin versions agree');
});

test('every plugin hook names a script that exists, through the plugin root', () => {
  const root = join(SKILL, '..', '..');
  const hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const events = Object.keys(hooks);
  assert.deepEqual(events.sort(), ['PreToolUse', 'SessionStart', 'SubagentStop', 'UserPromptSubmit']);

  for (const groups of Object.values(hooks)) {
    for (const g of groups) {
      for (const h of g.hooks) {
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?\.mjs)/.exec(h.command);
        assert.ok(m, `hook command uses the plugin root: ${h.command}`);
        assert.ok(existsSync(join(root, m[1])), `${m[1]} exists`);
        assert.ok(h.timeout > 0, 'every hook has a timeout');
      }
    }
  }
  // turn-check and return-check are deliberately absent: they come from the
  // skill's own frontmatter and each agent file, so they are live only when the
  // skill is, rather than on every turn of every session.
  const all = JSON.stringify(hooks);
  assert.doesNotMatch(all, /turn-check|return-check/);
});
