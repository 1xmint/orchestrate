// Shared by the hidden tests. Reads the workspace from BENCH_WS and never
// writes to it: each call gets its own data file in a scratch directory.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function shelf() {
  const ws = process.env.BENCH_WS;
  if (!ws) throw new Error('BENCH_WS is not set');
  const scratch = mkdtempSync(join(tmpdir(), 'shelf-hidden-'));
  const file = join(scratch, 'data.json');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [join(ws, 'shelf.js'), ...args], {
      cwd: scratch,
      env: { ...process.env, SHELF_FILE: file },
      encoding: 'utf8',
      timeout: 20000,
    });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  const done = () => rmSync(scratch, { recursive: true, force: true });
  return { run, done };
}
