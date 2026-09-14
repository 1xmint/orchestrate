#!/usr/bin/env node
// diagnose.mjs — one reproducible snapshot of how orchestrate sees this machine
// and this session, for a bug report or a before/after comparison. Read-only:
// it changes no settings, no stored readings and nothing a hook has announced.
//
//   node diagnose.mjs                      this session (CLAUDE_CODE_SESSION_ID), else the newest transcript here
//   node diagnose.mjs --session <id>       a named session
//   node diagnose.mjs <transcript.jsonl>   a transcript file
//   node diagnose.mjs ... --no-codex       skip asking Codex for its login state
//   node diagnose.mjs ... --json           the same as JSON
//
// What it holds: versions (this copy, the installed plugin, Node), the running
// host, the policy in force, which hooks the settings file registers, the
// context report, the agent-tree meter, Codex state and whether a fresh Claude
// quota snapshot exists. What it never holds: credentials, account emails,
// prompts or file contents. The home folder is written as ~ so the output can be
// pasted as it is.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from './lib/policy.mjs';
import { hostCapabilities } from './lib/host.mjs';
import { OUR_SCRIPTS } from './lib/settings.mjs';
import { readQuota } from './lib/quota.mjs';
import { findSessionTranscript } from './lib/context.mjs';
import { buildReport } from './context.mjs';
import { measureTree, treeReport, latestTranscript } from './measure.mjs';
import { status as codexStatus } from './codex-worker.mjs';

const SELF = fileURLToPath(import.meta.url);
export const DIAG_V = 1;

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

export function versions({ home = homedir(), self = SELF } = {}) {
  const manifest = readJson(resolve(dirname(self), '..', '..', '..', '.claude-plugin', 'plugin.json'));
  const installed = readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const entries = Object.entries((installed && installed.plugins) || installed || {})
    .filter(([k, v]) => /^orchestrate@/.test(k) && Array.isArray(v))
    .flatMap(([k, v]) => v.map(e => ({ id: k, scope: e.scope || null, version: e.version || null, commit: e.gitCommitSha ? String(e.gitCommitSha).slice(0, 7) : null, lastUpdated: e.lastUpdated || null })));
  return { thisCopy: (manifest && manifest.version) || null, installed: entries, node: process.version, platform: process.platform };
}

// Which of our scripts the user settings file runs (the script install), by event.
export function registeredHooks(settingsPath = join(homedir(), '.claude', 'settings.json')) {
  const s = readJson(settingsPath);
  const out = {};
  for (const [event, groups] of Object.entries((s && s.hooks) || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (g && g.hooks) || []) {
        const script = OUR_SCRIPTS.find(n => String(h.command || '').includes(n));
        if (script) (out[event] ||= []).push(script);
      }
    }
  }
  return out;
}

export function pickTranscript({ transcript = null, session = null, env = process.env, cwd = process.cwd() } = {}) {
  if (transcript) return existsSync(transcript) && statSync(transcript).isFile() ? transcript : null;
  const id = session || env.CLAUDE_CODE_SESSION_ID || null;
  if (id) { const p = findSessionTranscript(id); if (p) return p; if (session) return null; }
  return latestTranscript(cwd) || null;
}

export function diagnose({ transcript = null, session = null, env = process.env, cwd = process.cwd(), codex = true, home = homedir(), now = Date.now(), policy = loadPolicy(), settingsPath, reportsPath } = {}) {
  const errors = [];
  const attempt = (name, fn) => { try { return fn(); } catch (e) { errors.push(`${name}: ${String(e && e.message)}`); return null; } };
  const path = pickTranscript({ transcript, session, env, cwd });
  const quota = attempt('quota', () => readQuota(now));
  const out = {
    v: DIAG_V,
    at: new Date(now).toISOString(),
    versions: attempt('versions', () => versions({ home })),
    host: attempt('host', () => hostCapabilities({ env, transcriptPath: path })),
    policy,
    hooks: attempt('hooks', () => registeredHooks(settingsPath || join(home, '.claude', 'settings.json'))),
    transcript: path,
    context: path ? attempt('context', () => buildReport({ transcript: path, now, policy })) : null,
    tree: null,
    codex: codex ? attempt('codex', () => codexStatus({ env })) : 'skipped',
    claudeQuota: quota ? { fresh: true, at: quota.at || null, fiveHour: quota.fiveHour ? quota.fiveHour.pct : null, week: quota.week ? quota.week.pct : null } : { fresh: false, note: 'no fresh snapshot for this account (Desktop does not run the status line)' },
    errors,
  };
  if (path) {
    const t = attempt('tree', () => measureTree(path, reportsPath ? { reportsPath } : {}));
    if (t) out.tree = { totals: t.totals, text: treeReport(t) };
  }
  return JSON.parse(redactHome(JSON.stringify(out), home));
}

// The home folder, in either slash style, JSON-escaped, or as Claude Code spells
// it inside a project folder name (C--Users-name-...), becomes ~.
export function redactHome(text, home = homedir()) {
  if (!home) return text;
  const forms = new Set([home, home.replace(/\\/g, '/'), JSON.stringify(home).slice(1, -1), home.replace(/[^A-Za-z0-9]/g, '-')]);
  let s = text;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) s = s.split(f).join('~');
  return s;
}

export function humanDiagnosis(d) {
  const L = [`orchestrate diagnosis ${d.at}`];
  const v = d.versions || {};
  L.push(`version: this copy ${v.thisCopy || 'unknown'}; installed ${(v.installed || []).map(e => `${e.version} (${e.scope}${e.commit ? `, ${e.commit}` : ''})`).join(', ') || 'none'}; node ${v.node} on ${v.platform}`);
  const h = d.host || {};
  L.push(`host: ${h.entrypoint || 'unknown'} engine ${h.engine || 'unknown'}${h.desktopApp ? `, desktop app ${h.desktopApp}` : ''} (from ${h.engineSource || 'nowhere'})`);
  const c = d.policy.context, w = d.policy.workers, x = d.policy.codex;
  L.push(`policy: checkpoint ${c.checkpointAt / 1000}k, compact ${c.compactAt / 1000}k or ${Math.round(c.windowFraction * 100)}% of a smaller window · ${w.maxConcurrent} workers, browser ${w.browserConcurrent} · nested ${w.nested}, general-purpose ${w.generalPurpose} · codex ${x.enabled ? 'on' : 'off'}`);
  const hooks = Object.entries(d.hooks || {});
  L.push(`settings-file hooks: ${hooks.length ? hooks.map(([e, s]) => `${e}: ${s.join(', ')}`).join('; ') : 'none (plugin hooks only)'}`);
  L.push(`transcript: ${d.transcript || 'none found'}`);
  if (d.context) {
    const r = d.context.reading;
    L.push(`context: ${r.tokens == null ? 'unknown' : `${Math.round(r.tokens / 1000)}k`} (${r.state}${r.stale ? ', stale' : ''}) · advice ${d.context.advice.action}${d.context.advice.why ? ` — ${d.context.advice.why}` : ''}`);
  }
  if (d.tree) L.push(d.tree.text);
  if (d.codex === 'skipped') L.push('codex: skipped');
  else if (d.codex) L.push(`codex: ${d.codex.bin ? 'found' : 'not found'} · ${d.codex.login.text} · model ${d.codex.model || 'unknown'} · running ${d.codex.running.length} · usage-limit entries ${d.codex.exhausted.length}`);
  L.push(`claude quota: ${d.claudeQuota.fresh ? `five-hour ${d.claudeQuota.fiveHour}%, week ${d.claudeQuota.week}%` : d.claudeQuota.note}`);
  for (const e of d.errors) L.push(`error: ${e}`);
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2);
  const val = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const transcript = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--session') || null;
  try {
    const d = diagnose({ transcript, session: val('--session'), codex: !args.includes('--no-codex') });
    if ((transcript || val('--session')) && !d.transcript) { console.error('no such transcript or session'); process.exit(2); }
    console.log(args.includes('--json') ? JSON.stringify(d, null, 2) : humanDiagnosis(d));
  } catch (e) { console.error(String(e && e.message)); process.exit(1); }
}
