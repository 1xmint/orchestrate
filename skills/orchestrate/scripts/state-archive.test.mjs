// state-archive.test.mjs — STATE.md holds only the newest release and the
// one before it in full (AGENTS.md:49-51); older entries move to
// docs/state/<version>.md so a fresh session can read where we are in one
// page. Pins the shape, not the byte count: fails if a third version
// section creeps back into STATE.md, or an "Earlier releases" link goes
// stale or duplicates content that is also still inline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STATE_MD = join(ROOT, 'STATE.md');

const stateText = readFileSync(STATE_MD, 'utf8');

const headings = [...stateText.matchAll(/^## (.+)$/gm)].map(m => m[1]);

test('STATE.md has at most two version sections before "Earlier releases"', () => {
  const earlierIdx = headings.indexOf('Earlier releases');
  assert.notEqual(earlierIdx, -1, 'STATE.md has an "## Earlier releases" heading');
  const before = headings.slice(0, earlierIdx);
  assert.ok(
    before.length <= 2,
    `expected at most 2 version sections before "Earlier releases", found ${before.length}: ${before.join(' | ')}`,
  );
  // Nothing follows the index section.
  assert.equal(earlierIdx, headings.length - 1, '"Earlier releases" is the last heading in STATE.md');
});

test('every "Earlier releases" link points to a file that exists and starts with a version heading', () => {
  const section = stateText.slice(stateText.indexOf('## Earlier releases'));
  const links = [...section.matchAll(/\[([^\]]+)\]\((docs\/state\/[^)]+)\)/g)];
  assert.ok(links.length > 0, 'the index lists at least one archived file');
  for (const [, linkText, relPath] of links) {
    const filePath = join(ROOT, relPath);
    assert.ok(existsSync(filePath), `${relPath} exists on disk`);
    const fileText = readFileSync(filePath, 'utf8');
    assert.match(fileText, /^## .+$/m, `${relPath} starts with a "## " heading`);
    assert.ok(fileText.startsWith('## '), `${relPath} starts with "## ", not blank lines or other text`);
    assert.equal(
      fileText.split('\n')[0],
      `## ${linkText}`,
      `${relPath}'s heading matches its index link text`,
    );
  }
});

test('no "## v" heading appears both in STATE.md and in an archived file', () => {
  const section = stateText.slice(stateText.indexOf('## Earlier releases'));
  const links = [...section.matchAll(/\((docs\/state\/[^)]+)\)/g)].map(m => m[1]);
  const keptVersionHeadings = headings.filter(h => /^v\d/.test(h));
  for (const relPath of links) {
    const fileText = readFileSync(join(ROOT, relPath), 'utf8');
    const archivedHeadings = [...fileText.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    for (const h of archivedHeadings) {
      if (!/^v\d/.test(h)) continue; // sub-headings swept into the version's own file are fine
      assert.ok(
        !keptVersionHeadings.includes(h),
        `"${h}" appears both in STATE.md and in ${relPath}`,
      );
    }
  }
});
