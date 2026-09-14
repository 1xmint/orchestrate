// lib/host.mjs — what the running host can do, from the host itself.
//
// The Claude desktop app embeds its own Claude Code engine, and it is not the
// terminal `claude` on PATH: on one machine Desktop's transcripts said 2.1.270
// while `claude --version` said 2.1.209. So capabilities are read from this
// session's own transcript records (their `version` and `entrypoint`) and the
// environment the host gives hooks and commands, and never from a CLI probe.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { findSessionTranscript, readContext } from './context.mjs';

export function compareVersions(a, b) {
  const pa = String(a || '').split(/[.-]/).map(n => parseInt(n, 10));
  const pb = String(b || '').split(/[.-]/).map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0, y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Features this plugin uses that arrived in a known engine version, from the
// hooks reference. Unknown version: unknown, never assumed.
export const SINCE = { promptId: '2.1.196', scratchpadDir: '2.1.257' };

export function hostCapabilities({ env = process.env, transcriptPath = null, quotaPath = join(homedir(), '.claude', 'orchestrate', 'quota.json') } = {}) {
  const session = env.CLAUDE_CODE_SESSION_ID || null;
  const path = transcriptPath || findSessionTranscript(session);
  const host = path ? (readContext(path, { session, capacity: null }).host || {}) : {};
  const engine = host.version || null;
  const has = v => (engine ? compareVersions(engine, v) >= 0 : null);
  return {
    entrypoint: host.entrypoint || env.CLAUDE_CODE_ENTRYPOINT || null,
    engine,
    engineSource: engine ? 'this session\'s transcript' : 'unknown (no transcript found for this session)',
    desktopApp: env.CLAUDE_CODE_DESKTOP_APP_VERSION || null,
    session,
    hookPromptId: has(SINCE.promptId),
    hookScratchpadDir: has(SINCE.scratchpadDir),
    hookAgentId: true,
    permissionModeInHooks: true,
    // Desktop sessions have not been seen running a status line; nothing here
    // depends on one.
    statusLineData: existsSync(quotaPath) ? 'seen' : 'not seen on this machine',
    note: 'capabilities come from the running host, not from the terminal CLI on PATH',
  };
}
