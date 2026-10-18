#!/usr/bin/env node
// grade-kept.mjs — score a finished `claude plugin eval` run from what it kept,
// following bench/RULE.md exactly. Pure functions behind a thin command line.
//
//   node evals/grade-kept.mjs --aggregate <aggregate-result.json> \
//        --hidden <bench-hidden dir> --arm <name> --out <dir>
//
// Writes <out>/rows.json, <out>/table.md and <out>/traces/*.jsonl. The eval's
// "with" arm is labelled <name>; its "without" arm is labelled "no-plugin".
//
//   node evals/grade-kept.mjs combine --dir <downloaded results> \
//        --incumbent <arm> --candidate <arm> --out verdict.md
//
// Joins every leg's rows.json, voids pairs across legs, and writes the verdict.
//
// Assumptions about the eval's output that the pilot must confirm are marked
// PILOT below. Everything else is the documented aggregate-result.json shape
// (schemaVersion 1): cases[].arms.{with,without}[] with costUsd,
// judgeCostUsd, durationSeconds, error, tracePath and graders[].{name,passed}.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, cpSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureTree, sessionDollars } from '../skills/orchestrate/scripts/measure.mjs';

// Graders that are reported and never decide whether a run is correct.
export const REPORT_ONLY = ['claims-done', 'communication'];
export const NO_PLUGIN = 'no-plugin';

const slash = p => String(p || '').replace(/\\/g, '/');

// ---------------------------------------------------------------- readRuns

// One row per run. Runs the eval never started (exit 2, cost ceiling) are
// padded in from runsPerCase so the pair rule can see them.
export function readRuns(aggregate, { arm = 'with' } = {}) {
  const rows = [];
  for (const c of (aggregate && aggregate.cases) || []) {
    const want = Number(c.runsPerCase) || 0;
    for (const key of Object.keys(c.arms || {})) {
      const label = key === 'with' ? arm : key === 'without' ? NO_PLUGIN : key;
      const runs = c.arms[key] || [];
      const n = Math.max(runs.length, want);
      for (let i = 0; i < n; i++) {
        const r = runs[i];
        if (!r) { rows.push({ case: c.name, arm: label, index: i, cost: 0, judgeCost: 0, seconds: 0, error: null, graders: {}, tracePath: null, turns: 0, unstarted: true }); continue; }
        const graders = {};
        for (const g of r.graders || []) graders[g.name] = g.passed === true;
        rows.push({
          case: c.name, arm: label, index: i,
          cost: Number(r.costUsd) || 0, judgeCost: Number(r.judgeCostUsd) || 0,
          seconds: Number(r.durationSeconds) || 0,
          error: r.error == null ? null : String(r.error),
          graders, tracePath: r.tracePath || null, turns: Number(r.turns) || 0,
          unstarted: false,
        });
      }
    }
  }
  return rows;
}

// -------------------------------------------------------------- workspaceOf

const realFs = {
  isDir: p => { try { return statSync(p).isDirectory(); } catch { return false; } },
  list: p => { try { return readdirSync(p); } catch { return []; } },
};

// The eval's temp root for a run: the folder holding the trace's folder.
// PILOT: observed layout is <tmp>/claude-eval-XXXX/{config,home,out,tmp} with
// the trace at out/trace.jsonl, the workspace at home/cwd and Claude Code's
// own transcripts at config/projects/<slug>/<session>.jsonl.
export function evalRootOf(tracePath, fs = realFs) {
  const parts = slash(tracePath).split('/').filter((s, i) => s !== '' || i === 0);
  const dirs = [];
  for (let n = parts.length - 1; n >= 1; n--) dirs.push(parts.slice(0, n).join('/') || '/');
  // dirs[0] is the trace's folder, dirs[1] its parent, and so on.
  for (const d of dirs.slice(0, 4)) if (fs.isDir(`${d}/home`) || fs.isDir(`${d}/config`)) return d;
  return dirs[1] || dirs[0] || null;
}

// Search tolerantly: the real --keep-temp layout is only confirmed at the pilot.
export function workspaceOf(tracePath, fs = realFs) {
  if (!tracePath) return null;
  const root = evalRootOf(tracePath, fs);
  if (!root) return null;
  const known = ['home/cwd', 'home/workspace', 'home/work', 'workspace', 'cwd', 'work', 'ws'];
  for (const k of known) if (fs.isDir(`${root}/${k}`)) return `${root}/${k}`;
  const sub = fs.list(`${root}/home`).filter(n => !n.startsWith('.') && fs.isDir(`${root}/home/${n}`));
  if (sub.length) return `${root}/home/${sub[0]}`;
  return null;
}

// ---------------------------------------------------------------- validity

const FAILURE = /timed out|timeout|max[ _-]?turns|turn limit|maximum number of turns|reached .*turns/i;
const USAGE = /usage limit|rate limit|limit reached|hit your limit|out of (extra )?usage|too many requests|\b429\b|overloaded/i;
const CREDENTIAL = /credential|authenticat|unauthori[sz]ed|invalid (api key|x-api-key|token)|oauth|not logged in|\/login|\b401\b|\b403\b/i;
const SCAFFOLD = /scaffold/i;
const SANDBOX = /cannot confine|no sandbox backend|bubblewrap|bwrap/i;
const CRASH = /^exit \d+|crash|spawn |ENOENT|EACCES|could not start|failed to start|internal error|SIGSEGV|SIGKILL|killed/i;
const READS_HIDDEN = /bench-hidden|(?:^|[^\w.-])bench(?:\/|\\\\|\\)/m;

// What the agent asked its tools to do: the input of every tool_use, the
// helpers' included. Only these count as reading, because the start-up record,
// tool output and the plugin's own text can name a folder the agent never
// opened, and that text is in one arm only. A trace with no parsable record
// is scanned whole, so a changed format voids rather than passes.
export function toolInputs(traceText) {
  const out = [];
  let records = 0;
  for (const line of String(traceText || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o.type !== 'string') continue;
    records++;
    const content = o.type === 'assistant' && Array.isArray(o.message?.content) ? o.message.content : [];
    for (const c of content) if (c?.type === 'tool_use') out.push(JSON.stringify(c.input ?? {}));
  }
  return records ? out.join('\n') : String(traceText || '');
}

// Void only machine faults. A timeout, running out of turns or a wrong result
// is a failure and stays valid, with its cost.
export function validity(row, traceText = '') {
  if (row.unstarted) return { valid: false, reason: 'left unstarted' };
  const e = row.error;
  if (e) {
    if (FAILURE.test(e)) return { valid: true };
    if (USAGE.test(e)) return { valid: false, reason: 'usage limit' };
    if (CREDENTIAL.test(e)) return { valid: false, reason: 'credential rejected' };
    if (SCAFFOLD.test(e)) return { valid: false, reason: 'scaffold failed' };
    if (SANDBOX.test(e)) return { valid: false, reason: 'sandbox unavailable' };
    if (CRASH.test(e)) return { valid: false, reason: 'runner crash' };
  }
  if (traceText && READS_HIDDEN.test(toolInputs(traceText))) return { valid: false, reason: 'trace reads bench-hidden or bench' };
  return { valid: true };
}

// A voided run voids its pair: same case and run index in every other arm.
export function pairVoid(rows) {
  const bad = new Set(rows.filter(r => r.valid === false).map(r => `${r.case}#${r.index}`));
  return rows.map(r => (r.valid === false || !bad.has(`${r.case}#${r.index}`))
    ? r : { ...r, valid: false, voidReason: 'pair of a voided run' });
}

// --------------------------------------------------------------- runHidden

export function readMust(caseHiddenDir) {
  try { return JSON.parse(readFileSync(join(caseHiddenDir, 'must.json'), 'utf8')); } catch { return null; }
}

// Run each hidden test against a copy of the finished workspace. Pass means
// `node --test <file>` exits 0. Combine with the deciding graders' verdicts.
export function runHidden(workspace, caseHiddenDir, graders = {}) {
  const must = (caseHiddenDir && readMust(caseHiddenDir)) || { hidden: [], graders: null, timeoutSeconds: 120 };
  const deciding = must.graders || Object.keys(graders).filter(n => !REPORT_ONLY.includes(n));
  const graderVerdicts = Object.fromEntries(deciding.map(n => [n, graders[n] === true]));
  const out = { tests: [], graders: graderVerdicts, hiddenPass: false, correct: false, note: null };
  if (!workspace || !existsSync(workspace)) {
    out.note = 'no workspace';
    return out;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'bench-ws-'));
  try {
    const copy = join(tmp, 'ws');
    cpSync(workspace, copy, { recursive: true });
    const env = { ...process.env, BENCH_WS: copy };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // Inside `node --test` this variable makes a nested `node --test` report
    // success whatever happens, so a failing hidden test would read as a pass.
    delete env.NODE_TEST_CONTEXT;
    for (const f of must.hidden || []) {
      const r = spawnSync(process.execPath, ['--test', join(caseHiddenDir, f)], {
        env, encoding: 'utf8', timeout: (Number(must.timeoutSeconds) || 120) * 1000, cwd: tmp,
      });
      const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
      out.tests.push({ file: f, ok: r.status === 0 && !timedOut, timedOut });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  out.hiddenPass = out.tests.every(t => t.ok);
  out.correct = out.hiddenPass && Object.values(graderVerdicts).every(Boolean) && (must.hidden || []).length + deciding.length > 0;
  return out;
}

// ----------------------------------------------------------------- execUsd

// List-price dollars over every transcript Claude Code wrote for the run (the
// lead and its helpers), reported beside the eval's own cost, which includes
// judge calls. PILOT: transcripts at <root>/config/projects/*/*.jsonl.
export function transcriptsOf(root, fs = realFs) {
  const out = [];
  for (const slug of fs.list(`${root}/config/projects`)) {
    for (const f of fs.list(`${root}/config/projects/${slug}`)) if (f.endsWith('.jsonl')) out.push(`${root}/config/projects/${slug}/${f}`);
  }
  return out;
}

export function execUsd(tracePath) {
  const root = evalRootOf(tracePath);
  const files = root ? transcriptsOf(root) : [];
  if (!files.length) return { dollars: null, unpriced: 0, transcripts: 0 };
  let dollars = 0, unpriced = 0;
  for (const f of files) {
    const t = measureTree(f, { reportsPath: join(root, 'home', '.claude', 'orchestrate', 'workers', 'reports.jsonl') });
    const d = sessionDollars(t);
    dollars += d.dollars; unpriced += d.unpriced;
  }
  return { dollars, unpriced, transcripts: files.length };
}

// --------------------------------------------------------------- falseDone

// The last message says finished, done or ready, and the run is not correct.
export const falseDone = row => row.graders && row.graders['claims-done'] === true && row.correct !== true;

// -------------------------------------------------------- summary and table

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const spendOf = r => (r.execUsd != null ? r.execUsd : r.cost);

function sum(rows) {
  const valid = rows.filter(r => r.valid !== false);
  const successes = valid.filter(r => r.correct === true).length;
  const spend = valid.reduce((s, r) => s + spendOf(r), 0);
  return {
    runs: rows.length, valid: valid.length, successes, spend,
    perSuccess: successes ? spend / successes : null,
    medianSeconds: median(valid.map(r => r.seconds)),
    falseDone: valid.filter(falseDone).length,
  };
}

// { arm: { ...totals, cases: { case: {...} } } }
export function summarize(rows) {
  const out = {};
  for (const arm of [...new Set(rows.map(r => r.arm))]) {
    const mine = rows.filter(r => r.arm === arm);
    out[arm] = { ...sum(mine), cases: {} };
    for (const c of [...new Set(mine.map(r => r.case))]) out[arm].cases[c] = sum(mine.filter(r => r.case === c));
  }
  return out;
}

const usd = n => (n == null ? 'n/a' : `$${n.toFixed(2)}`);
const secs = n => (n == null ? 'n/a' : String(Math.round(n)));

export function table(rows) {
  const s = summarize(rows);
  const head = '| Arm | Case | Valid runs | Successes | Total $ | $ per success | Median s | False done |\n|---|---|---|---|---|---|---|---|';
  const line = (arm, name, x) => `| ${arm} | ${name} | ${x.valid}/${x.runs} | ${x.successes} | ${usd(x.spend)} | ${usd(x.perSuccess)} | ${secs(x.medianSeconds)} | ${x.falseDone} |`;
  const L = [head];
  for (const arm of Object.keys(s)) for (const c of Object.keys(s[arm].cases)) L.push(line(arm, c, s[arm].cases[c]));
  for (const arm of Object.keys(s)) L.push(line(`**${arm}**`, '**total**', s[arm]));
  const voided = rows.filter(r => r.valid === false);
  if (voided.length) {
    L.push('', 'Voided (machine faults, not counted):');
    for (const r of voided) L.push(`- ${r.arm} / ${r.case} / run ${r.index + 1}: ${r.voidReason}`);
  }
  return L.join('\n') + '\n';
}

// ----------------------------------------------------------------- verdict

// RULE.md's decision order, exactly. `incumbent` and `candidate` are one arm's
// summary from summarize(). Pass { confirmed: true } on the second look, when
// the extra runs on a short case are already in the summaries: a case that is
// still short then loses. Pass { safetyStopRemoved: true } if the change
// removes guard-bash or a stop-and-ask rule (a fact only a reader can supply).
export function verdict(incumbent, candidate, { confirmed = false, safetyStopRemoved = false } = {}) {
  const reasons = [];
  const loss = why => ({ result: 'clear-loss', reasons: [...reasons, why], needsConfirmation: [], needsReason: false });

  // 1. Gates.
  if (candidate.falseDone > incumbent.falseDone) return loss(`gate: false "done" ${candidate.falseDone} vs ${incumbent.falseDone}`);
  if (safetyStopRemoved) return loss('gate: removes a safety stop');
  reasons.push('gates pass');

  // 2. Successes.
  if (candidate.successes < incumbent.successes) return loss(`successes: ${candidate.successes} vs ${incumbent.successes}`);
  const short = Object.keys(incumbent.cases || {}).filter(c => ((candidate.cases || {})[c] || { successes: 0 }).successes < incumbent.cases[c].successes);
  if (short.length && confirmed) return loss(`successes: still short after extra runs on ${short.join(', ')}`);
  if (short.length) {
    reasons.push(`case shortfall on ${short.join(', ')}: both arms get 3 more runs there`);
    return { result: 'inconclusive', reasons, needsConfirmation: short, needsReason: false };
  }
  reasons.push(`successes ${candidate.successes} vs ${incumbent.successes}`);

  // 3. Cost per success.
  let costWin = false;
  if (incumbent.perSuccess != null && candidate.perSuccess != null && incumbent.perSuccess > 0) {
    const ratio = candidate.perSuccess / incumbent.perSuccess;
    if (ratio >= 1.15) return loss(`cost per success ${ratio.toFixed(2)}x`);
    if (ratio <= 0.85) { costWin = true; reasons.push(`cost per success ${ratio.toFixed(2)}x`); }
    else reasons.push(`cost per success ${ratio.toFixed(2)}x, inside the band`);
  } else reasons.push('cost per success not comparable (an arm has no successes)');

  // 4. Time.
  let needsReason = false;
  if (incumbent.medianSeconds && candidate.medianSeconds != null && candidate.medianSeconds / incumbent.medianSeconds > 1.25) {
    needsReason = true;
    reasons.push(`median time ${(candidate.medianSeconds / incumbent.medianSeconds).toFixed(2)}x: a written reason is needed to ship`);
  }

  const more = candidate.successes - incumbent.successes;
  if (more >= 2 || costWin) return { result: 'clear-win', reasons, needsConfirmation: [], needsReason };
  return { result: 'inconclusive', reasons, needsConfirmation: [], needsReason };
}

// ----------------------------------------------------------------- combine

// Every rows.json under a folder of downloaded results, one per matrix leg.
export function findRows(dir) {
  const out = [];
  const walk = d => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      let s; try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (n === 'rows.json') out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

// The legs graded themselves; a voided run there voids its pair here, across
// every arm. RULE.md decides candidate against incumbent; every plugin arm
// against no plugin is reported and decides nothing.
export function combine(rowSets, { incumbent, candidate, confirmed = false, safetyStopRemoved = false }) {
  const rows = pairVoid(rowSets.flat());
  const s = summarize(rows);
  const missing = [incumbent, candidate].filter(a => !s[a]);
  const v = missing.length ? null : verdict(s[incumbent], s[candidate], { confirmed, safetyStopRemoved });
  const L = [`# Bench verdict: ${candidate} against ${incumbent}`, ''];
  if (v) {
    L.push(`**${v.result}**`, '', ...v.reasons.map(r => `- ${r}`));
    if (v.needsConfirmation.length) L.push(`- next: 3 more runs for both arms on ${v.needsConfirmation.join(', ')}, then combine with --confirmed`);
    if (v.needsReason) L.push('- a written reason for the slower time is needed before it ships');
  } else L.push(`No verdict: no rows for ${missing.join(' and ')}.`);
  if (s[NO_PLUGIN]) {
    L.push('', 'Against no plugin (reported, not deciding):');
    for (const a of Object.keys(s).filter(a => a !== NO_PLUGIN)) {
      const w = verdict(s[NO_PLUGIN], s[a]);
      L.push(`- ${a}: ${w.result}; ${w.reasons.join('; ')}`);
    }
  }
  L.push('', table(rows));
  return { rows, summary: s, verdict: v, markdown: L.join('\n') };
}

// --------------------------------------------------------------------- CLI

export function gradeAggregate(aggregate, { hiddenDir, arm }) {
  const rows = readRuns(aggregate, { arm });
  const graded = rows.map(r => {
    let traceText = '';
    try { if (r.tracePath) traceText = readFileSync(r.tracePath, 'utf8'); } catch {}
    const v = validity(r, traceText);
    const ws = workspaceOf(r.tracePath);
    const x = execUsd(r.tracePath || '');
    let h = { tests: [], graders: {}, hiddenPass: false, correct: false, note: null };
    if (!r.unstarted) h = runHidden(ws, hiddenDir ? join(hiddenDir, r.case) : null, r.graders);
    const row = { ...r, valid: v.valid, voidReason: v.reason || null, workspace: ws, hidden: h.tests, deciding: h.graders, hiddenPass: h.hiddenPass, correct: h.correct, note: h.note, execUsd: x.dollars, unpriced: x.unpriced };
    row.falseDone = falseDone(row);
    return row;
  });
  return pairVoid(graded);
}

function main(argv) {
  const get = k => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  if (argv[0] === 'combine') {
    const dir = get('dir'), incumbent = get('incumbent'), candidate = get('candidate'), file = get('out');
    if (!dir || !incumbent || !candidate || !file) { console.error('usage: grade-kept.mjs combine --dir <downloaded results> --incumbent <arm> --candidate <arm> --out <verdict.md> [--confirmed] [--safety-stop-removed]'); return 1; }
    const sets = findRows(dir).map(p => JSON.parse(readFileSync(p, 'utf8')));
    const c = combine(sets, { incumbent, candidate, confirmed: argv.includes('--confirmed'), safetyStopRemoved: argv.includes('--safety-stop-removed') });
    writeFileSync(file, c.markdown);
    process.stdout.write(c.markdown);
    return c.verdict ? 0 : 1;
  }
  const agg = get('aggregate'), hidden = get('hidden'), arm = get('arm'), out = get('out');
  if (!agg || !arm || !out) { console.error('usage: grade-kept.mjs --aggregate <file> --hidden <bench-hidden dir> --arm <name> --out <dir>'); return 1; }
  const aggregate = JSON.parse(readFileSync(agg, 'utf8'));
  const rows = gradeAggregate(aggregate, { hiddenDir: hidden, arm });
  mkdirSync(join(out, 'traces'), { recursive: true });
  for (const r of rows) {
    if (r.tracePath && existsSync(r.tracePath)) {
      try { copyFileSync(r.tracePath, join(out, 'traces', `${r.case}__${r.arm}__${r.index + 1}.jsonl`)); } catch {}
    }
  }
  // The workspace and temp paths are machine details: keep them out of the upload.
  const clean = rows.map(({ workspace, tracePath, ...rest }) => rest);
  writeFileSync(join(out, 'rows.json'), JSON.stringify(clean, null, 2));
  const md = table(rows);
  writeFileSync(join(out, 'table.md'), md);
  process.stdout.write(md);
  return 0;
}

if (basename(slash(process.argv[1])) === basename(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
