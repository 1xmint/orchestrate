#!/usr/bin/env node
// Multi-turn "resume" scenario. Drives headless `claude -p` over several turns:
// the first turn is cut off by --max-turns (standing in for a usage-limit stop),
// then the script answers a planted question once, sends "continue" otherwise,
// and counts nudges and re-asked questions until the hidden tests pass.
//
// Pure functions are exported for the test; main() is a thin command line.
// Nothing here calls the network by itself: the only outside process is the
// `claude` binary named by --claude, and the test passes a fake one.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SCENARIO_DIR = join(HERE, 'resume');
const HIDDEN_DIR = join(ROOT, 'bench-hidden', 'scenarios', 'resume');

export const DEFAULTS = {
  runs: 3, model: 'claude-opus-5-5', firstTurns: 25, turns: 40, maxNudges: 5,
  claude: 'claude', compactAfter: null,
};

// ---------- pure helpers ----------

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function parseCli(argv) {
  const o = { ...DEFAULTS, pluginDir: null, noPlugin: false, label: null, cap: null, out: null, keepTemp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--plugin-dir') o.pluginDir = next();
    else if (a === '--no-plugin') o.noPlugin = true;
    else if (a === '--label') o.label = next();
    else if (a === '--runs') o.runs = Number(next());
    else if (a === '--cap') o.cap = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--claude') o.claude = next();
    else if (a === '--model') o.model = next();
    else if (a === '--first-turns') o.firstTurns = Number(next());
    else if (a === '--turns') o.turns = Number(next());
    else if (a === '--max-nudges') o.maxNudges = Number(next());
    else if (a === '--compact-after') o.compactAfter = Number(next());
    else if (a === '--hidden-dir') o.hiddenDir = next();
    else if (a === '--keep-temp') o.keepTemp = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!!o.pluginDir === o.noPlugin) throw new Error('give exactly one of --plugin-dir <dir> or --no-plugin');
  if (!o.label) throw new Error('--label is required');
  if (!o.out) throw new Error('--out is required');
  if (!Number.isFinite(o.cap) || o.cap <= 0) throw new Error('--cap <usd> is required: write the spend limit down first');
  for (const k of ['runs', 'firstTurns', 'turns', 'maxNudges']) {
    if (!Number.isInteger(o[k]) || o[k] < 0) throw new Error(`--${k} must be a whole number`);
  }
  return o;
}

export function claudeArgs({ prompt, resume, maxTurns, model, pluginDir }) {
  // The prompt comes straight after -p so no later option can swallow it.
  const a = ['-p', prompt, '--output-format', 'json', '--model', model,
    '--max-turns', String(maxTurns), '--permission-mode', 'bypassPermissions'];
  if (resume) a.push('--resume', resume);
  if (pluginDir) a.push('--plugin-dir', pluginDir);
  return a;
}

// The CLI prints one object, or (verbose) an array that holds it.
export function parseResult(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
  let v = tryParse(text);
  if (v === undefined) v = tryParse(text.split(/\r?\n/).filter(Boolean).pop());
  if (Array.isArray(v)) v = [...v].reverse().find((x) => x && x.type === 'result') ?? null;
  return v && typeof v === 'object' ? v : null;
}

export function findQuestion(text, questions) {
  for (const q of questions) {
    if (new RegExp(q.match, 'is').test(text || '')) return q;
  }
  return null;
}

// What to send after a turn whose hidden tests did not pass.
export function decideNext({ lastMessage, questions, answered, nudges, maxNudges }) {
  const q = findQuestion(lastMessage, questions);
  if (q) {
    return answered.has(q.id)
      ? { action: 'answer', text: q.answer, id: q.id, reAsked: true }
      : { action: 'answer', text: q.answer, id: q.id, reAsked: false };
  }
  if (nudges >= maxNudges) return { action: 'stop', reason: 'max-nudges' };
  return { action: 'continue', text: 'continue' };
}

const DONE_RE = /\b(all (five|5|of (the|these)) (parts|items|commands)|all done|everything (is|works)|(is|are|now) (done|complete|finished|ready)|(i('| ha)ve|i've) (finished|completed|built)|done\b|complete[d]?\b)/i;
export function claimsDone(text) { return DONE_RE.test(text || ''); }

const USAGE_RE = /usage limit|limit reached|rate.?limit|resets? (at|in)\b|out of (extra )?usage|quota/i;
const AUTH_RE = /authenticat|unauthori[sz]ed|invalid (api key|token|credentials)|not logged in|please run \/login|oauth token|\b401\b|\b403\b/i;

// Machine faults only. A turn limit (error_max_turns) is the planted stop, not a fault.
export function detectVoid({ exitCode, json, stdout, stderr }) {
  const text = `${json && typeof json.result === 'string' ? json.result : ''}\n${stdout || ''}\n${stderr || ''}`;
  const failed = exitCode !== 0 || !json || json.is_error === true;
  const maxTurns = json && json.subtype === 'error_max_turns';
  if (failed && !maxTurns) {
    if (USAGE_RE.test(text)) return 'usage limit reached';
    if (AUTH_RE.test(text)) return 'auth rejected';
    if (!json) return 'claude crashed or printed non-JSON';
    if (json.is_error === true) return `claude error (${json.subtype || 'unknown'})`;
  }
  return null;
}

export function jsonlFiles(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...jsonlFiles(p));
    else if (e.name.endsWith('.jsonl')) found.push(p);
  }
  return found;
}

// Isolation check: nothing the model saw or did may mention the hidden checks.
export function leaksHidden(texts, hiddenDir) {
  const needles = ['bench-hidden', hiddenDir, hiddenDir.replace(/\\/g, '/'), hiddenDir.replace(/\\/g, '\\\\')]
    .filter(Boolean).map((n) => n.toLowerCase());
  return texts.some((t) => { const l = String(t).toLowerCase(); return needles.some((n) => l.includes(n)); });
}

export function scrub(text, secrets) {
  let s = String(text ?? '');
  for (const sec of secrets) if (sec && sec.length >= 8) s = s.split(sec).join('[redacted]');
  return s;
}

export function summarize(records) {
  const arms = [...new Set(records.map((r) => r.arm))];
  const money = (n) => `$${n.toFixed(2)}`;
  const out = ['# Resume scenario', ''];
  for (const arm of arms) {
    const all = records.filter((r) => r.arm === arm);
    const valid = all.filter((r) => !r.void);
    const wins = valid.filter((r) => r.success);
    const cost = valid.reduce((s, r) => s + r.costUsd, 0);
    const med = (k) => { const m = median(valid.map((r) => r[k])); return m === null ? 'n/a' : String(m); };
    out.push(`## ${arm}`, '',
      '| valid runs | successes | total $ | $ per success | median nudges | total re-asked | median seconds |',
      '|---|---|---|---|---|---|---|',
      `| ${valid.length} | ${wins.length} | ${money(cost)} | ${wins.length ? money(cost / wins.length) : 'n/a'} | ${med('nudges')} | ${valid.reduce((s, r) => s + r.reAsked, 0)} | ${med('seconds')} |`,
      '');
    const voids = all.filter((r) => r.void);
    if (voids.length) out.push(`Void runs (machine fault, left out above): ${voids.length} (${[...new Set(voids.map((r) => r.voidReason))].join('; ')})`, '');
    const compact = [...new Set(all.map((r) => r.compact))].filter((c) => c !== 'off');
    if (compact.length) out.push(`/compact: ${compact.join(', ')}`, '');
  }
  return out.join('\n') + '\n';
}

// ---------- side-effecting pieces ----------

function git(cwd, env, ...args) {
  return spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
}

export function setupWorkspace(fixtureDir, env) {
  const ws = mkdtempSync(join(tmpdir(), 'resume-ws-'));
  cpSync(fixtureDir, ws, { recursive: true });
  git(ws, env, 'init', '-q');
  git(ws, env, 'add', '-A');
  git(ws, env, 'commit', '-q', '-m', 'start');
  return ws;
}

// Runs the hidden tests on a copy so they can never change the workspace.
export function runHidden(ws, hiddenDir = HIDDEN_DIR) {
  const must = JSON.parse(readFileSync(join(hiddenDir, 'must.json'), 'utf8'));
  const copy = mkdtempSync(join(tmpdir(), 'resume-hidden-'));
  try {
    cpSync(ws, copy, { recursive: true, filter: (p) => !/[\\/]\.git([\\/]|$)/.test(p) });
    const env = { ...process.env, BENCH_WS: copy };
    delete env.NODE_TEST_CONTEXT; // lets this run from inside node --test and still report failures
    const files = must.hidden.map((f) => join(hiddenDir, f));
    const r = spawnSync(process.execPath, ['--test', ...files], {
      cwd: hiddenDir, env, encoding: 'utf8',
      timeout: (must.timeoutSeconds || 120) * 1000,
    });
    return { passed: r.status === 0 };
  } finally { rmSync(copy, { recursive: true, force: true }); }
}

function spawnClaude(claude, args, env, cwd, timeoutMs) {
  const isScript = /\.(mjs|js|cjs)$/i.test(claude);
  const r = spawnSync(isScript ? process.execPath : claude, isScript ? [claude, ...args] : args,
    { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

export function runOne({ opts, index, arm, scenarioDir = SCENARIO_DIR, hiddenDir = HIDDEN_DIR, costSoFar = () => 0 }) {
  const started = Date.now();
  const answersSheet = JSON.parse(readFileSync(join(scenarioDir, 'answers.json'), 'utf8'));
  const prompt = readFileSync(join(scenarioDir, 'prompt.md'), 'utf8');
  const home = mkdtempSync(join(tmpdir(), 'resume-home-'));
  const configDir = join(home, '.claude');
  mkdirSync(configDir, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDir };
  delete env.ANTHROPIC_API_KEY; // never bill an API key; the subscription token is the only credential
  const secrets = [process.env.CLAUDE_CODE_OAUTH_TOKEN];
  const ws = setupWorkspace(join(scenarioDir, 'fixture'), env);

  const rec = {
    arm, run: index, success: false, nudges: 0, reAsked: 0, turns: 0, invocations: 0, costUsd: 0,
    seconds: 0, claimsDone: false, void: false, voidReason: null, stopReason: null,
    answered: [], compact: 'off',
  };
  const stdouts = [];
  const answered = new Set();
  let sessionId = null;
  let lastMessage = '';
  let pending = { text: prompt, maxTurns: opts.firstTurns };
  let compactSent = false;
  const invocationLimit = 1 + opts.maxNudges + answersSheet.questions.length + 4;

  try {
    for (;;) {
      const args = claudeArgs({
        prompt: pending.text, resume: sessionId, maxTurns: pending.maxTurns,
        model: opts.model, pluginDir: opts.pluginDir || null,
      });
      const res = spawnClaude(opts.claude, args, env, ws, 45 * 60 * 1000);
      rec.invocations++;
      stdouts.push(res.stdout);
      const json = parseResult(res.stdout);
      const fault = detectVoid({ exitCode: res.status, json, stdout: res.stdout, stderr: res.stderr });
      if (json) {
        rec.costUsd += Number(json.total_cost_usd) || 0;
        rec.turns += Number(json.num_turns) || 0;
        if (json.session_id) sessionId = json.session_id;
      }
      if (fault) { rec.void = true; rec.voidReason = scrub(fault, secrets); break; }

      const isCompactTurn = pending.compact === true;
      if (isCompactTurn) {
        const wrote = jsonlFiles(configDir).some((f) => readFileSync(f, 'utf8').includes('compact_boundary'));
        rec.compact = wrote ? 'honoured' : 'untested';
      } else {
        lastMessage = json && typeof json.result === 'string' ? json.result : '';
      }

      if (runHidden(ws, hiddenDir).passed) { rec.success = true; rec.stopReason = 'passed'; break; }
      if (costSoFar() + rec.costUsd >= opts.cap) { rec.stopReason = 'cap'; break; }
      if (rec.invocations >= invocationLimit) { rec.stopReason = 'invocation-limit'; break; }

      if (opts.compactAfter && rec.invocations === opts.compactAfter && !compactSent) {
        compactSent = true;
        pending = { text: '/compact', maxTurns: opts.turns, compact: true };
        continue;
      }
      const next = decideNext({
        lastMessage, questions: answersSheet.questions, answered,
        nudges: rec.nudges, maxNudges: opts.maxNudges,
      });
      if (next.action === 'stop') { rec.stopReason = next.reason; break; }
      if (next.action === 'answer') {
        if (next.reAsked) rec.reAsked++; else { answered.add(next.id); rec.answered.push(next.id); }
      } else rec.nudges++;
      pending = { text: next.text, maxTurns: opts.turns };
    }
    rec.claimsDone = claimsDone(lastMessage);

    // Isolation check over everything the model saw or did.
    const texts = [...stdouts, ...jsonlFiles(configDir).map((f) => readFileSync(f, 'utf8'))];
    if (!rec.void && leaksHidden(texts, hiddenDir)) {
      rec.void = true; rec.voidReason = 'transcript mentions the hidden checks';
    }
  } finally {
    rec.seconds = Math.round((Date.now() - started) / 1000);
    if (!opts.keepTemp) {
      rmSync(ws, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
  return rec;
}

export function runArm(opts, hooks = {}) {
  mkdirSync(opts.out, { recursive: true });
  const runsFile = join(opts.out, 'runs.jsonl');
  const arm = opts.label;
  let spent = 0;
  const made = [];
  for (let i = 1; i <= opts.runs; i++) {
    if (spent >= opts.cap) { made.push({ skipped: true, reason: 'cap' }); break; }
    const rec = runOne({ opts, index: i, arm, scenarioDir: hooks.scenarioDir, hiddenDir: hooks.hiddenDir, costSoFar: () => spent });
    spent += rec.costUsd;
    appendFileSync(runsFile, JSON.stringify(rec) + '\n');
    made.push(rec);
  }
  const all = readFileSync(runsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  writeFileSync(join(opts.out, 'summary.md'), summarize(all));
  return { records: made.filter((r) => !r.skipped), spent, capped: made.some((r) => r.skipped) };
}

function main() {
  let opts;
  try { opts = parseCli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const hiddenDir = opts.hiddenDir || HIDDEN_DIR;
  const r = runArm(opts, { hiddenDir });
  console.log(`runs: ${r.records.length}  spent: $${r.spent.toFixed(2)}${r.capped ? '  (cap reached, remaining runs skipped)' : ''}`);
  console.log(`wrote ${join(opts.out, 'summary.md')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
