#!/usr/bin/env node
// A stand-in for the Codex CLI, for codex-worker.test.mjs. It never touches the
// network. FAKE_CODEX_MODE picks the behaviour; FAKE_CODEX_LOG gets one JSON
// line per invocation (argv and cwd) so a test can prove what was, or was not,
// run.

import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const mode = process.env.FAKE_CODEX_MODE || 'success';
const argv = process.argv.slice(2);
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');

const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

if (argv[0] === 'login' && argv[1] === 'status') {
  if (mode === 'logged-out') { process.stderr.write('Not logged in\n'); process.exit(1); }
  // Simulate a `login status` that never answers: the parent's spawnSync
  // timeout kills this process, which is read back as exit code null. The
  // hang branches deliberately never call process.exit, so nothing below
  // this block ever runs for them.
  if (mode === 'login-retry-fail') { setInterval(() => {}, 1e9); }
  else if (mode === 'login-retry-once') {
    const cf = process.env.FAKE_LOGIN_COUNT_FILE;
    let n = 0;
    try { n = Number(readFileSync(cf, 'utf8')); } catch {}
    writeFileSync(cf, String(n + 1));
    if (n === 0) setInterval(() => {}, 1e9);
    else { process.stdout.write('Logged in using ChatGPT\n'); process.exit(0); }
  } else {
    process.stdout.write('Logged in using ChatGPT\n');
    process.exit(0);
  }
} else {
  if (argv[0] !== 'exec') { process.stderr.write('unexpected command\n'); process.exit(64); }

let prompt = '';
try { prompt = readFileSync(0, 'utf8'); } catch {}
const dir = flag('-C') || process.cwd();
const last = flag('-o');
const report = (status, checks = [{ command: 'node --test', result: 'pass', evidence: 'ok 3' }], remaining = []) => {
  if (last) writeFileSync(last, JSON.stringify({ status, summary: `fake ${status}`, changed: ['work.txt'], checks, remaining, notes: `prompt had ${prompt.length} chars` }));
};
const edit = () => writeFileSync(join(dir, 'work.txt'), 'changed by fake codex\n');

out({ type: 'thread.started', thread_id: 'th_fake' });
out({ type: 'turn.started' });

switch (mode) {
  case 'login-retry-once':
  case 'success':
    edit();
    out({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } });
    out({ type: 'turn.completed', usage: { input_tokens: 24763, cached_input_tokens: 24448, output_tokens: 122, reasoning_output_tokens: 0 } });
    report('done');
    process.exit(0);
    break;
  case 'checks-fail':
    edit();
    out({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 } });
    report('done', [{ command: 'npm test', result: 'fail', evidence: '1 failing' }]);
    process.exit(0);
    break;
  case 'quota-before':
    out({ type: 'error', message: "You've hit your usage limit. Upgrade to Pro or try again in 3 days 4 hours." });
    out({ type: 'turn.failed', error: { message: "You've hit your usage limit." } });
    process.exit(1);
    break;
  case 'quota-after':
    edit();
    out({ type: 'turn.completed', usage: { input_tokens: 5000, cached_input_tokens: 0, output_tokens: 300 } });
    out({ type: 'error', message: 'exceeded retry limit, last status: 429 Too Many Requests, usage_limit_reached' });
    out({ type: 'turn.failed', error: { message: 'usage limit reached' } });
    process.exit(1);
    break;
  case 'auth':
    out({ type: 'error', message: 'unexpected status 401 Unauthorized: token could not be refreshed' });
    process.exit(1);
    break;
  case 'throttle':
    out({ type: 'error', message: 'exceeded retry limit, last status: 429 Too Many Requests' });
    process.exit(1);
    break;
  case 'malformed':
    edit();
    out({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
    if (last) writeFileSync(last, 'I finished everything, trust me.');
    process.stdout.write('{"type":"item.comp');
    process.exit(0);
    break;
  case 'hang':
    edit();
    setTimeout(() => process.exit(0), 120000);
    break;
  default:
    process.exit(0);
}
}
