// lib/commit-claim.test.mjs — pure text matching used by the Stop hook's
// commit check, tested without any transcript file or git repo.
//   node --test skills/orchestrate/scripts/lib/commit-claim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClaim, lastAssistantText, contradicts, countedPaths } from './commit-claim.mjs';

const line = rec => JSON.stringify(rec) + '\n';
const assistantText = (...texts) => line({ type: 'assistant', message: { content: texts.map(t => ({ type: 'text', text: t })) } });

// ---- lastAssistantText -------------------------------------------------------

test('lastAssistantText reads the assistant message that follows a user message', () => {
  const tail = line({ type: 'user', message: { content: [{ type: 'text', text: 'do it' }] } })
    + assistantText('done, and committed.');
  assert.equal(lastAssistantText(tail), 'done, and committed.');
});

test('lastAssistantText joins multiple text blocks in one message', () => {
  const tail = assistantText('first block.', 'second block.');
  assert.equal(lastAssistantText(tail), 'first block.\nsecond block.');
});

test('lastAssistantText ignores tool_use blocks and takes the most recent assistant message', () => {
  const tail = assistantText('first message.')
    + line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })
    + assistantText('final message, committed.');
  assert.equal(lastAssistantText(tail), 'final message, committed.');
});

test('lastAssistantText returns empty string when there is no assistant text', () => {
  assert.equal(lastAssistantText(''), '');
  assert.equal(lastAssistantText('not json\n'), '');
});

// ---- classifyClaim ------------------------------------------------------------

const notPhrases = [
  'I have not committed these changes to git.',
  "I haven't committed this yet.",
  'Nothing is committed.',
  'The changes are uncommitted.',
  'These files are not yet committed.',
  'I left the docs uncommitted.',
  "I didn't commit the fix.",
  'I did not commit the fix.',
];
for (const text of notPhrases) {
  test(`classifyClaim reads "${text}" as not-committed`, () => {
    assert.equal(classifyClaim(text), 'not-committed');
  });
}

const committedPhrases = [
  'I committed the fix.',
  'All committed.',
  'Everything is committed.',
  'The commits are in.',
];
for (const text of committedPhrases) {
  test(`classifyClaim reads "${text}" as committed`, () => {
    assert.equal(classifyClaim(text), 'committed');
  });
}

test('classifyClaim reads a sentence naming both kinds as mixed, never a single claim', () => {
  assert.equal(classifyClaim('I committed the fix, but not committed the docs.'), 'mixed');
});

test('classifyClaim reads two sentences that disagree with each other as mixed', () => {
  assert.equal(classifyClaim('I committed the fix. I have not committed the docs.'), 'mixed');
});

test('classifyClaim returns null when the message makes no claim about commits', () => {
  assert.equal(classifyClaim('The tests pass now.'), null);
  assert.equal(classifyClaim(''), null);
});

// ---- contradicts ----------------------------------------------------------------

test('contradicts: not-committed claim with a clean tree and commits since start is a contradiction', () => {
  assert.equal(contradicts('not-committed', 0, 4), true);
});

test('contradicts: not-committed claim with a dirty tree is not a contradiction', () => {
  assert.equal(contradicts('not-committed', 3, 4), false);
});

test('contradicts: committed claim with a dirty tree is a contradiction', () => {
  assert.equal(contradicts('committed', 2, 0), true);
});

test('contradicts: committed claim with a clean tree is not a contradiction', () => {
  assert.equal(contradicts('committed', 0, 4), false);
});

test('contradicts: not-committed claim with a clean tree and unknown commit count is still a contradiction', () => {
  assert.equal(contradicts('not-committed', 0, null), true);
});

test('contradicts: not-committed claim with a clean tree and zero commits since start is not a contradiction', () => {
  assert.equal(contradicts('not-committed', 0, 0), false);
});

test('contradicts: a mixed or absent claim is never a contradiction', () => {
  assert.equal(contradicts('mixed', 0, 4), false);
  assert.equal(contradicts(null, 3, 0), false);
});

// ---- countedPaths -------------------------------------------------------------

test("the plugin's own folders are not counted as uncommitted work", () => {
  assert.deepEqual(countedPaths(['.claude/', '.orchestrator/runs/x/RUN.md', 'server.js']), ['server.js']);
  assert.deepEqual(countedPaths(['.claude/worktrees/agent-1/a.js']), []);
  assert.deepEqual(countedPaths(['"path with space/.claude"', '.claude']), ['"path with space/.claude"']);
});

test('ordinary paths, including dotfiles, all count', () => {
  assert.deepEqual(countedPaths(['.gitignore', 'README.md', 'src/.claude-notes.md', 'lib/borrow.js']), ['.gitignore', 'README.md', 'src/.claude-notes.md', 'lib/borrow.js']);
  assert.deepEqual(countedPaths([]), []);
  assert.deepEqual(countedPaths(null), []);
});
