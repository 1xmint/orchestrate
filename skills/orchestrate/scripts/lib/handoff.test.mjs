// handoff.test.mjs — the pure lookup a fresh session uses to answer
// "continue what?": the newest session record in the same folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPreviousSession, formatAgo } from './handoff.mjs';

function makeSessions(records) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-sessions-'));
  for (const [id, rec] of Object.entries(records)) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec));
  }
  return dir;
}

test('finds the newest record with a goal in the same cwd', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    older: { session_id: 'older', cwd: 'C:/proj', goal: 'first thing', lastSeen: '2026-09-25T10:00:00Z' },
    newer: { session_id: 'newer', cwd: 'C:/proj', goal: 'second thing', lastSeen: '2026-09-25T11:00:00Z' },
  });
  const prev = findPreviousSession({ sessionsDir, cwd: 'C:/proj', exceptId: 'current', now });
  assert.equal(prev && prev.session_id, 'newer');
});

test('a different cwd is not a match', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    a: { session_id: 'a', cwd: 'C:/other-project', goal: 'thing', lastSeen: '2026-09-25T11:00:00Z' },
  });
  assert.equal(findPreviousSession({ sessionsDir, cwd: 'C:/proj', exceptId: 'current', now }), null);
});

test('cwd comparison ignores case and slash direction (win32)', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    a: { session_id: 'a', cwd: 'C:\\Proj\\App', goal: 'thing', lastSeen: '2026-09-25T11:00:00Z' },
  });
  const prev = findPreviousSession({ sessionsDir, cwd: 'c:/proj/app', exceptId: 'current', now });
  assert.ok(prev, 'same folder despite case and slash differences');
});

test('older than maxAgeMs is not a match', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    a: { session_id: 'a', cwd: 'C:/proj', goal: 'thing', lastSeen: '2026-09-01T00:00:00Z' },
  });
  assert.equal(findPreviousSession({ sessionsDir, cwd: 'C:/proj', exceptId: 'current', now, maxAgeMs: 7 * 86400000 }), null);
});

test('the asking session\'s own record is skipped', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    self: { session_id: 'self', cwd: 'C:/proj', goal: 'thing', lastSeen: '2026-09-25T11:59:00Z' },
  });
  assert.equal(findPreviousSession({ sessionsDir, cwd: 'C:/proj', exceptId: 'self', now }), null);
});

test('a record with no goal is skipped', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const sessionsDir = makeSessions({
    a: { session_id: 'a', cwd: 'C:/proj', lastSeen: '2026-09-25T11:00:00Z' },
  });
  assert.equal(findPreviousSession({ sessionsDir, cwd: 'C:/proj', exceptId: 'current', now }), null);
});

test('a missing sessions directory is "no sessions", not a throw', () => {
  assert.equal(findPreviousSession({ sessionsDir: join(tmpdir(), 'does-not-exist-xyz'), cwd: 'C:/proj', exceptId: 'x' }), null);
});

test('formatAgo picks the coarsest unit that reads as at least one', () => {
  assert.equal(formatAgo(90 * 1000), '2 minutes');
  assert.equal(formatAgo(1 * 60 * 1000), '1 minute');
  assert.equal(formatAgo(3 * 3600 * 1000), '3 hours');
  assert.equal(formatAgo(2 * 86400 * 1000), '2 days');
});
