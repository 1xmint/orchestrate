import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runSteps } from '../skills/orchestrate/scripts/gate.mjs';
import { parseCli } from '../bench/scenarios/resume.mjs';

// Text checks on the bench workflow: it is public, runs on a subscription
// sign-in, and must never put the token in an upload. No yaml dependency.
const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'bench.yml'), 'utf8').replace(/\r\n/g, '\n');
const lines = yml.split('\n');
const code = lines.filter(l => !l.trim().startsWith('#')).join('\n');

// Steps: split on "      - " at the step indent.
const steps = code.split(/\n(?=      - )/).slice(1);
const runStep = steps.find(s => /name: Run bench/.test(s));
const uploadStep = steps.find(s => /actions\/upload-artifact/.test(s));
const evalCalls = code.split('\n').filter(l => /claude plugin eval /.test(l));

test('dispatch only, read-only permissions', () => {
  assert.match(code, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(code, /^\s{2}(push|pull_request|schedule|pull_request_target):/m);
  assert.match(code, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(code, /^\s+[a-z-]+: write$/m);
});

test('no API key anywhere', () => {
  assert.ok(!/ANTHROPIC_API_KEY/.test(yml));
});

test('every eval call is private, pins full model ids and sets --ablation', () => {
  assert.ok(evalCalls.length >= 1);
  for (const l of evalCalls) {
    assert.match(l, /--no-publish/);
    assert.match(l, /--model claude-[a-z]+-\d+-\d+\b/);
    assert.match(l, /--judge-model claude-[a-z]+-\d+-\d+\b/);
    assert.match(l, /--ablation /);
    assert.match(l, /--max-cost-usd /);
  }
});

test('the eval exit code is recorded and tolerated', () => {
  assert.match(runStep, /set \+e[\s\S]*claude plugin eval[\s\S]*RC=\$\?[\s\S]*set -e/);
});

test('the leak scan runs before the upload and checks the token and sk-ant-', () => {
  const scan = code.indexOf('grep -rlF');
  assert.ok(scan > 0 && scan < code.indexOf('actions/upload-artifact'));
  assert.match(runStep, /grep -rlF -e "\$CLAUDE_CODE_OAUTH_TOKEN"/);
  assert.match(runStep, /grep -rlF -e 'sk-ant-'/);
  // A match fails the job without echoing the file or the match.
  assert.match(runStep, /exit 1/);
  assert.doesNotMatch(runStep, /grep -rF/);
  assert.doesNotMatch(runStep, /grep [^\n]*-[a-zA-Z]*n[a-zA-Z]* [^\n]*OAUTH/);
});

test('the upload takes only the staged files, never the temp home, config or auth folders', () => {
  assert.match(uploadStep, /path: \$\{\{ runner\.temp \}\}\/upload\n/);
  assert.match(uploadStep, /retention-days: 7/);
  assert.doesNotMatch(uploadStep, /\.claude|\.config|HOME|home|auth|credentials|--keep-temp|out\b/i);
  // What the run step stages: only the named result files.
  const staged = [...runStep.matchAll(/cp (?:-r )?([^\n]*?) "\$STAGE"/g)].map(m => m[1]).join(' ');
  for (const f of ['aggregate-result.json', 'rows.json', 'table.md', 'traces', 'runs.jsonl', 'summary.md', '*.html']) assert.ok(staged.includes(f), f);
  assert.doesNotMatch(staged, /home|config|\.claude|auth/i);
});

test('no run line is one the shipped gate reader would take as a check', () => {
  // orchestrate 0.21.0 lists these lines from every workflow as the repo's
  // checks and pastes them into helper briefs; this pattern is its CI_COMMAND.
  const shipped = /^(just|make|npm|pnpm|yarn|cargo|pytest|python -m pytest|ruff|mypy|go test|dotnet test|node\s+(--test\b|scripts\/\S+))/;
  const taken = runSteps(yml).filter(c => shipped.test(c));
  assert.deepEqual(taken, []);
});

test('the token appears only as env on the run step', () => {
  assert.equal(code.split('secrets.').length - 1, 1);
  assert.match(runStep, /env:\n(?:          [A-Z_]+: .*\n)*          CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
  for (const s of steps) if (s !== runStep) assert.ok(!/CLAUDE_CODE_OAUTH_TOKEN/.test(s));
  assert.ok(!/^env:/m.test(code), 'no workflow-level env');
});

// A step's `run: |` text with its indent taken off. Steps keep `run:` at eight
// spaces and the shell under it at ten.
const runBody = step => {
  const at = step.split('\n');
  const i = at.findIndex(l => /^ {8}run: \|\s*$/.test(l));
  assert.ok(i >= 0, 'the step has a run block');
  const body = [];
  for (const l of at.slice(i + 1)) {
    if (l.trim() && !l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n');
};

test('a scorer crash is recorded, not swallowed, and does not stop the leak scan or the upload', () => {
  const gradeLine = runStep.split('\n').find(l => /node evals\/grade-kept\.mjs/.test(l));
  assert.ok(gradeLine, 'the run step calls the scorer');
  // The old `|| echo "grade-kept failed"` let the job finish green. Now a crash
  // leaves a marker, and the step carries on (the files help to debug it).
  assert.match(gradeLine, /\|\| \{[^}]*> "\$RUNNER_TEMP\/grade-crash"; \}/);
  assert.doesNotMatch(gradeLine, /\$STAGE|\/upload/, 'the marker is not staged for upload');
  assert.ok(runStep.indexOf('grade-crash') < runStep.indexOf('grep -rlF'), 'recorded before the leak scan, which still runs');
  // A leak still fails the run step, and a failed run step still withholds the upload.
  assert.match(uploadStep, /if: success\(\)/);
});

test('the last step fails the job on a recorded crash, after the upload', () => {
  const last = steps[steps.length - 1];
  assert.match(last, /name: Fail the job if the scorer crashed/);
  assert.ok(steps.indexOf(last) > steps.indexOf(uploadStep), 'after the upload');
  // Also when an earlier step failed, so the crash is named then too.
  assert.match(last, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(last, /::error::grade-kept crashed/);
});

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
test('that step passes with no marker and fails with an error naming the crash when there is one', { skip: hasBash ? false : 'bash is not installed' }, () => {
  const body = runBody(steps[steps.length - 1]);
  const tmp = mkdtempSync(join(tmpdir(), 'bench-wf-'));
  try {
    const go = () => spawnSync('bash', ['-c', body], { env: { ...process.env, RUNNER_TEMP: tmp }, encoding: 'utf8' });
    const clean = go();
    assert.equal(clean.status, 0);
    assert.equal(clean.stdout, '');
    writeFileSync(join(tmp, 'grade-crash'), 'exit 1\n');
    const crashed = go();
    assert.equal(crashed.status, 1);
    assert.match(crashed.stdout, /^::error::grade-kept crashed \(exit 1\)/m);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('the scenario call asks for a summary after the cut-off turn, in words the script itself accepts', () => {
  const calls = code.split('\n').filter(l => /bench\/scenarios\/resume\.mjs/.test(l));
  assert.equal(calls.length, 1);
  // The words the shell passes, with each variable given a value. The script's
  // own parser reads them, so a renamed or misspelt switch fails here.
  const values = { '"${PLUG[@]}"': '--no-plugin', '"$LABEL"': 'arm', '"$RUNS"': '1', '"$CAP"': '1', '"$OUT/scenario"': 'out' };
  const argv = calls[0].trim().split(/\s+/).slice(2).map(w => (w in values ? values[w] : w));
  assert.ok(!argv.some(w => w.includes('$')), `give every shell variable a value here: ${argv.join(' ')}`);
  const opts = parseCli(argv);
  // 1 is straight after the cut-off turn, before the first "continue".
  assert.equal(opts.compactAfter, 1);
});
