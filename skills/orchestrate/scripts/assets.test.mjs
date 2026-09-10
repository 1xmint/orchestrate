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

test('no role agent carries a Stop hook that can send a finished return back', () => {
  // There was one, and every reason it blocked for — a missing restatement, a
  // return over 60 lines, a field in the wrong order — was formatting. Each
  // block spent a real model turn to buy a shape, and in plan mode it spent
  // four on one piece of finished work. A return is now filed as it arrives.
  assert.ok(!existsSync(join(SKILL, 'scripts', 'return-check.mjs')), 'the return check is gone, not just unregistered');
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    assert.doesNotMatch(fm, /^hooks:$/m, f);
    assert.doesNotMatch(fm, /return-check/, f);
  }
});

test('no role agent can dispatch another one', () => {
  // Delegation belongs to the lead: a nested dispatch spends quota the ledger
  // never sees and returns nothing anyone grades. Enforced by the host's own
  // tool restrictions, not by asking the agent nicely.
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(AGENTS, f), 'utf8'));
    const allow = (/^tools: (.+)$/m.exec(fm) || [])[1];
    const deny = (/^disallowedTools: (.+)$/m.exec(fm) || [])[1] || '';
    if (allow) assert.doesNotMatch(allow, /\bAgent\b/, `${f} allowlist must not include Agent`);
    else assert.match(deny, /\bAgent\b/, `${f} has no allowlist, so it must deny Agent`);
  }
});

test('no role agent pins an effort level over the one the user chose', () => {
  for (const f of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    assert.doesNotMatch(frontmatter(readFileSync(join(AGENTS, f), 'utf8')), /^effort:/m, f);
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

// packet.md is the only thing a dispatch reads. There used to be an 11 KB
// contracts.md explaining this 4 KB template field by field; it was deleted,
// because the six agent files already carry their own role rules and said them
// better. The four things it had that the template did not now live here.
test('assets/packet.md carries every field a dispatch needs', () => {
  const packet = readFileSync(join(SKILL, 'assets', 'packet.md'), 'utf8');
  assert.ok(!existsSync(join(SKILL, 'references', 'contracts.md')), 'contracts.md stays deleted');
  // Four fields always, because a packet without one of them is the packet that
  // produced the wrong thing. Everything else is conditional, and a conditional
  // field that does not apply is cost with no benefit.
  const always = ['TASK:', 'OBJECTIVE', 'CONTEXT', 'SCOPE', 'DONE WHEN'];
  for (const f of always) assert.ok(packet.includes(f), `packet.md has ${f}`);
  const whenTheyApply = ['RUN:', 'BLOCKS ON:', 'WHERE:', 'OWNS:', 'GATE:', 'VERIFY LIVE:',
    'PRIOR ATTEMPTS:', 'PATTERNS:', 'SKILLS:', 'STOP AND REPORT:'];
  for (const f of whenTheyApply) assert.ok(packet.includes(f), `packet.md still offers ${f}`);
  assert.match(packet, /Add a field only when the answer is not "none"/);
  // The return schema, and nothing that polices its shape.
  for (const f of ['STATUS:', 'CHANGED:', 'EVIDENCE:', 'NOT VERIFIED:']) {
    assert.ok(packet.includes(f), `packet.md has ${f}`);
  }
  assert.doesNotMatch(packet, /RESTATED/, 'a restatement is not a field a return is judged on');
  assert.doesNotMatch(packet, /at most 40 lines|under 55 lines/, 'no length cap on a return');
  // The bits contracts.md is gone but was right about.
  assert.match(packet, /Never put in a packet/);
  assert.match(packet, /gate\.json/);
  assert.ok(packet.includes('ROLE: reviewer'), 'the reviewer packet is here too');
  assert.ok(packet.includes('VERDICT: PASS|FAIL'), 'with the one schema');
  assert.ok(packet.length < 6500, `packet.md is ${packet.length} bytes; it exists to be small`);
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

test('no shipped file turns a price into a share of a subscription week', () => {
  // The two thresholds that used to live here — mention over 5% of a week, ask
  // over 25% — both divided by a weekly dollar figure that came from a single
  // observation. A percentage computed from that reads like a measurement, and
  // the reader has no way to tell that it is not one. The figure is gone, so
  // the percentages have to be gone too, in prose as well as in code.
  const files = [
    join(SKILL, 'SKILL.md'),
    ...readdirSync(join(SKILL, 'references')).map(f => join(SKILL, 'references', f)),
    join(SKILL, 'assets', 'packet.md'),
    join(SKILL, 'assets', 'RUN.md'),
  ].filter(p => p.endsWith('.md'));
  for (const p of files) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      // A line saying the rule was removed is allowed to name the old numbers.
      if (/used to|there used to|no longer|is gone|are gone|rested on/i.test(line)) continue;
      assert.doesNotMatch(line, /\d+% of (a|your) .{0,12}week/i, `${p.split(/[\\/]/).pop()}: ${line.trim()}`);
    }
  }
  const routing = flat(readFileSync(join(SKILL, 'references', 'routing.md'), 'utf8'));
  assert.match(routing, /List price is not what a subscription is billed/);
  assert.match(routing, /Never a running total/);
});

test('the run ledger keeps the goal above the task table', () => {
  // What a resuming session has to recover. Task history is long, mostly
  // finished, and on disk; these four are the run itself.
  const run = readFileSync(join(SKILL, 'assets', 'RUN.md'), 'utf8');
  for (const h of ['Goal', 'Done when', 'Constraints and non-goals', 'Approach', 'Shape', 'Pickup']) {
    assert.match(run, new RegExp(`^## ${h}$`, 'm'), `RUN.md has ## ${h}`);
  }
  assert.match(run, /Why it matters/);
  assert.match(run, /Next deliverable/);
  assert.match(run, /why not smaller/);
  assert.match(flat(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')), /Fill the four sections above the task table before the first dispatch/);
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
  /a clue to what they want, not the whole of it/i,
  /Agreement is not a deliverable/i,
  /Lead with the answer/i,
  /what is from memory/i,
  /Recommend, and say what it costs/i,
  /Never (expose|show) the machinery/i,
  /if they ignore/i,
];

test('SKILL.md carries the plain-speech rules, each with its own test', () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /How to talk to the user/);
  // The reader is an adult who has not learned the words, not a child. The
  // difference shows up in the output: one gets simpler words, the other gets
  // simpler facts.
  assert.match(skill, /intelligent adult who has not learned engineering words/);
  assert.doesNotMatch(skill, /fifteen/);
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

  // The style is `force-for-plugin`, so it sits in the system prompt of every
  // session while the plugin is enabled and is paid for on every turn of every
  // one of them. The cap moved from 4,500 to 4,700 once, in v0.9.0, to hold
  // three rules that were not here before: recommend and price the tradeoff,
  // say the assumption that mattered, and never show the machinery. Cutting
  // prose to defend a round number is how a file loses the rules that earn it.
  assert.ok(Buffer.byteLength(style) <= 4700, `the style is ${Buffer.byteLength(style)} bytes, cap 4700`);
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
