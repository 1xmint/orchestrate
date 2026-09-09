#!/usr/bin/env node
// smoke.mjs — prove an external agent CLI can actually answer before a run
// leans on it. Spends a tiny amount of that provider's quota. Run it once per
// provider per session, not routinely.
//
//   node smoke.mjs <claude|codex|opencode>

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';
const name = process.argv[2];

function onPath(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()).concat(['']) : [''];
  for (const d of (process.env.PATH || '').split(IS_WIN ? ';' : ':').filter(Boolean)) {
    for (const e of exts) {
      const p = join(d, cmd + e);
      try { if (statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}
const PROMPT = 'Reply with exactly the two letters OK and nothing else.';
const shapes = {
  claude:   { cmd: 'claude',   args: ['-p', PROMPT, '--model', 'haiku', '--output-format', 'text'] },
  codex:    { cmd: 'codex',    args: ['exec', '--skip-git-repo-check', PROMPT] },
  opencode: { cmd: 'opencode', args: ['run', PROMPT] },
};
if (!shapes[name]) { console.error('usage: smoke.mjs <claude|codex|opencode>'); process.exit(2); }

const exe = onPath(shapes[name].cmd);
if (!exe) { console.error(`${name}: not on PATH`); process.exit(2); }
console.log(`smoke ${name}: this spends a small amount of ${name} quota; 90s cap`);
const t0 = Date.now();
const needsShell = IS_WIN && /\.(cmd|bat)$/i.test(exe);
const q = a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const opts = { encoding: 'utf8', timeout: 90000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } };
const r = needsShell
  ? spawnSync(`"${exe}" ${shapes[name].args.map(q).join(' ')}`, { ...opts, shell: true })
  : spawnSync(exe, shapes[name].args, { ...opts, shell: false });
const ms = Date.now() - t0;
const out = ((r.stdout || '') + (r.stderr || '')).trim();
const ok = r.status === 0 && /\bOK\b/.test(out);
const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
console.log(`exit: ${r.status}  time: ${(ms / 1000).toFixed(1)}s${timedOut ? '  TIMED OUT (treat as hung, not slow)' : ''}`);
console.log(`tail: ${out.split('\n').slice(-3).join(' | ').slice(0, 300)}`);
if (/usage limit|rate limit|try again|quota|not logged in|not signed in|unauthori[sz]ed|please (log|sign) in/i.test(out)) {
  console.log('signal: quota or auth problem; drop this provider for the run');
}
console.log(ok ? 'result: usable' : 'result: NOT usable');
process.exit(ok ? 0 : 1);
