// A stand-in for the claude binary, for resume.test.mjs. No network, no quota.
// FAKE_SCRIPT: path to JSON {"turns":[{...}]}, one entry per call in a session.
// FAKE_STATE:  path to a scratch JSON file this script keeps between calls.
// FAKE_LOG:    path to a JSONL file; one line per call (prompt, resume, flags).
// FAKE_RIGHT:  directory copied into the working directory when a turn says "apply".
// Turn fields: result, subtype, isError, cost, numTurns, apply, crash, raw, exit,
// transcript (text appended to a session .jsonl), compactBoundary.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const prompt = argv[0] === '-p' ? argv[1] : '';
const resume = flag('--resume');
const script = JSON.parse(readFileSync(process.env.FAKE_SCRIPT, 'utf8'));
const stateFile = process.env.FAKE_STATE;
let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { idx: 0, n: 0 };
if (!resume) state = { idx: 0, n: state.n + 1 };
const turn = script.turns[Math.min(state.idx, script.turns.length - 1)];
state.idx += 1;
writeFileSync(stateFile, JSON.stringify(state));
const sessionId = `fake-session-${state.n}`;

appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  prompt, resume, maxTurns: flag('--max-turns'), model: flag('--model'),
  pluginDir: flag('--plugin-dir'), permissionMode: flag('--permission-mode'),
  hasToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN), hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
  cwd: process.cwd(),
}) + '\n');

if (turn.apply) cpSync(process.env.FAKE_RIGHT, process.cwd(), { recursive: true });
if (turn.transcript || turn.compactBoundary) {
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'p');
  mkdirSync(dir, { recursive: true });
  const lines = [];
  if (turn.transcript) lines.push(JSON.stringify({ type: 'assistant', text: turn.transcript }));
  if (turn.compactBoundary) lines.push(JSON.stringify({ type: 'system', subtype: 'compact_boundary' }));
  appendFileSync(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}
if (turn.crash) { process.stderr.write('boom\n'); process.exit(1); }
if (turn.raw !== undefined) { process.stdout.write(turn.raw); process.exit(turn.exit ?? 0); }
process.stdout.write(JSON.stringify({
  type: 'result', subtype: turn.subtype || 'success', is_error: Boolean(turn.isError),
  result: turn.result ?? '', session_id: sessionId,
  total_cost_usd: turn.cost ?? 0, num_turns: turn.numTurns ?? 1,
}));
process.exit(turn.exit ?? 0);
