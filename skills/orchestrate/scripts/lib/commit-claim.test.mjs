// lib/commit-claim.test.mjs — pure text matching used by the Stop hook's
// commit check, tested without any transcript file or git repo.
//   node --test skills/orchestrate/scripts/lib/commit-claim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClaim, lastAssistantText, contradicts, countedPaths, namesAllPaths } from './commit-claim.mjs';

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

// A verb list between "did not"/"didn't" and "commit" is still a
// not-committed claim, not only the bare "did not commit" wording (round-9
// audit finding 2: a true sentence, "did not touch, add, or commit
// notes.txt", was blocked because only the literal phrase matched).
const didNotCommitListPhrases = [
  'I did not commit notes.txt.',
  'I did not touch, add, or commit notes.txt.',
  'I did not add, stage, or commit notes.txt.',
  'I did not touch, stage, change, or commit notes.txt.',
];
for (const text of didNotCommitListPhrases) {
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

// ---- namesAllPaths -------------------------------------------------------------

test('namesAllPaths is true when the message names every path by basename', () => {
  assert.equal(namesAllPaths('notes.txt is the user\'s own untracked file.', ['notes.txt']), true);
  assert.equal(namesAllPaths('I named a.js and b.js already.', ['src/a.js', 'b.js']), true);
});

test('namesAllPaths is false when a path is missing or the list is empty', () => {
  assert.equal(namesAllPaths('a.js is fine.', ['src/a.js', 'b.js']), false);
  assert.equal(namesAllPaths('committed everything', []), false);
  assert.equal(namesAllPaths('committed everything', null), false);
});

test('namesAllPaths is true for an untracked directory status entry when the message names a path under it', () => {
  assert.equal(namesAllPaths('src/notes.txt is the user\'s own untracked file.', ['src/']), true);
});

test('namesAllPaths is false for an untracked directory status entry when nothing under it is named', () => {
  assert.equal(namesAllPaths('everything else is committed.', ['src/']), false);
});
