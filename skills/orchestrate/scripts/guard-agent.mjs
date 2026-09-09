#!/usr/bin/env node
// guard-agent.mjs — a PreToolUse hook for the Agent tool that holds the two
// money rules mechanically, and keeps secrets out of packets.
//
// Rules:
//   - tier pro or api: model "fable" is denied unless ~/.claude/orchestrate/fable-optin.json
//     has {"date": "<today, local>"}; write it with `node profile.mjs --fable-optin`.
//   - tier max5 / max20: at most 3 / 6 fable dispatches per local day (counter file);
//     the same opt-in file lifts the cap for the day.
//   - any model: a packet containing something that looks like a credential is denied.
//
// Install (once), in ~/.claude/settings.json:
//   "hooks": { "PreToolUse": [ { "matcher": "Agent", "hooks": [
//     { "type": "command", "command": "node \"~/.claude/skills/orchestrate/scripts/guard-agent.mjs\"" } ] } ] }
// `node scripts/install.mjs --with-hook` writes that entry for you.
//
// Reads the hook payload from stdin; prints a deny decision or nothing.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.claude', 'orchestrate');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

let payload = '';
try { payload = readFileSync(0, 'utf8'); } catch {}
let input = null;
try { input = JSON.parse(payload); } catch { process.exit(0); }
if (!input || input.tool_name !== 'Agent') process.exit(0);
const ti = input.tool_input || {};
const model = String(ti.model || '').toLowerCase();
const prompt = String(ti.prompt || '');

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `orchestrate guard: ${reason}` } }));
  process.exit(0);
}

// secrets never travel in a packet
if (/\b(sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(prompt)) {
  deny('the packet contains something that looks like a credential; remove it and refer to it by name instead');
}

if (!/fable/.test(model)) process.exit(0);

// The hook can be registered twice (skill frontmatter plus settings.json).
// The same payload within a few seconds is the same dispatch: count it once.
try {
  const sig = `${input.session_id || ''}|${ti.subagent_type || ''}|${model}|${prompt.length}|${prompt.slice(0, 200)}`;
  const seenPath = join(DIR, 'last-dispatch.json');
  const seen = readJson(seenPath);
  const now = Date.now();
  if (seen && seen.sig === sig && now - seen.ts < 5000) process.exit(0);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(seenPath, JSON.stringify({ sig, ts: now }) + '\n');
} catch {}

// tier: the profile override, else what profile.mjs would detect
let tier = 'unknown';
const override = readJson(join(DIR, 'profile.json'));
if (override && override.tier && override.tier !== 'unknown') tier = override.tier;
else {
  const cfg = readJson(join(homedir(), '.claude.json'));
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return null;
    for (const [k, v] of Object.entries(o)) {
      if (/RateLimitTier|seatTier/.test(k) && typeof v === 'string') return v;
      if (v && typeof v === 'object') { const r = walk(v, depth + 1); if (r) return r; }
    }
    return null;
  };
  const raw = (walk(cfg) || '').toLowerCase();
  if (/max[_-]?20x|max20/.test(raw)) tier = 'max20';
  else if (/max[_-]?5x|max5|\bmax\b/.test(raw)) tier = 'max5';
  else if (/team|enterprise/.test(raw)) tier = 'team';
  else if (/\bpro\b|claude_pro|_pro_/.test(raw)) tier = 'pro';
  else if (process.env.ANTHROPIC_API_KEY) tier = 'api';
}

const optin = readJson(join(DIR, 'fable-optin.json'));
const optedInToday = Boolean(optin && optin.date === today);

if ((tier === 'pro' || tier === 'api' || tier === 'team' || tier === 'unknown') && !optedInToday) {
  deny(`tier is ${tier}: Fable bills usage credits (or is unknown). Ask the user; if they opt in for today run: node ~/.claude/skills/orchestrate/scripts/profile.mjs --fable-optin`);
}

const caps = { max5: 3, max20: 6 };
if (caps[tier] && !optedInToday) {
  const counterPath = join(DIR, `fable-count-${today}.json`);
  const c = readJson(counterPath) || { count: 0 };
  if (c.count >= caps[tier]) {
    deny(`${c.count} Fable dispatches already today on ${tier} (cap ${caps[tier]}, half the weekly limit is shared with the app). Use opus, or opt in for today: node ~/.claude/skills/orchestrate/scripts/profile.mjs --fable-optin`);
  }
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(counterPath, JSON.stringify({ count: c.count + 1, date: today }) + '\n'); } catch {}
}
process.exit(0);
