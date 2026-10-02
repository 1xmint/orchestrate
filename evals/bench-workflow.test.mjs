import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Text checks on the bench workflow: it is public, runs on a subscription
// sign-in, and must never put the token in an upload. No yaml dependency.
const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'bench.yml'), 'utf8');
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

test('the token appears only as env on the run step', () => {
  assert.equal(code.split('secrets.').length - 1, 1);
  assert.match(runStep, /env:\n(?:          [A-Z_]+: .*\n)*          CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
  for (const s of steps) if (s !== runStep) assert.ok(!/CLAUDE_CODE_OAUTH_TOKEN/.test(s));
  assert.ok(!/^env:/m.test(code), 'no workflow-level env');
});
