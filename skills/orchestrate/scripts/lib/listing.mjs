// lib/listing.mjs — what the host re-sends on every step before any work.
//
// Every enabled plugin puts a line per skill (name and description), its tool
// names and its tool servers' instructions into the context of every step of
// every session. One session on this machine started each step at ~75k tokens,
// ~14k of it these listings, most from plugins unrelated to the work. Past a
// size the host lists skills by bare name with no description, so an installed
// skill that would fit a task cannot be told apart from one that would not.
// Only the user can remove a plugin, so this reports the facts per plugin and
// leaves the judgment of what fits to the model and the choice to the user.
//
// The host records the listings as attachment records near the top of the
// transcript (`skill_listing`, `deferred_tools_delta`, `mcp_instructions_delta`).
// Read-only, no model calls, and any failure reads as "nothing known".

import { openSync, readSync, closeSync, statSync } from 'node:fs';

export const HEAD_BYTES = 600000;
const TOKENS_PER_CHAR = 1 / 3.6;
export const tokens = chars => Math.round(chars * TOKENS_PER_CHAR);

export function readHead(path, bytes = HEAD_BYTES) {
  try {
    const len = Math.min(bytes, statSync(path).size);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    try { readSync(fd, buf, 0, len, 0); } finally { closeSync(fd); }
    return buf.toString('utf8');
  } catch { return ''; }
}

const STANDALONE = '(standalone)';
const SKILL_LINE = /^-\s+([^\s:]+(?::[^\s:]+)?):?\s*(.*)$/;
// Words a skill description uses when the skill bills an outside service. A
// hint for the model to weigh, not a verdict: many listed skills carry no
// description at all.
const PAID_HINT = /api[ _-]?key|credits?\b|billing|subscription|paid plan|free tier|free trial|pricing/i;
const pluginOf = name => (String(name).includes(':') ? String(name).split(':')[0] : STANDALONE);
const serverPlugin = s => { const m = /^plugin:([^:]+):/.exec(String(s && s.name || s)); return m ? m[1] : null; };

export function parseListing(text) {
  const out = { found: false, skills: 0, skillChars: 0, nameOnly: 0, byPlugin: {}, toolNames: 0, toolChars: 0, servers: 0, serverChars: 0, needsAuth: 0, failed: 0 };
  const row = p => out.byPlugin[p] || (out.byPlugin[p] = { skills: 0, chars: 0, nameOnly: 0, tools: 0, paidHint: false, signIn: false, failed: false });
  for (const line of String(text || '').split('\n')) {
    if (!/"attachment"/.test(line) || !/skill_listing|deferred_tools_delta|mcp_instructions_delta/.test(line)) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const a = r && r.type === 'attachment' && r.attachment;
    if (!a) continue;
    if (a.type === 'skill_listing' && typeof a.content === 'string') {
      out.found = true;
      out.skills = Number(a.skillCount) || (Array.isArray(a.names) ? a.names.length : 0);
      out.skillChars += a.content.length;
      let last = null;
      for (const l of a.content.split('\n')) {
        const m = SKILL_LINE.exec(l);
        if (!m) { if (last) { last.chars += l.length + 1; if (PAID_HINT.test(l)) last.paidHint = true; } continue; }
        last = row(pluginOf(m[1]));
        last.skills++; last.chars += l.length + 1;
        if (!m[2]) { last.nameOnly++; out.nameOnly++; }
        else if (PAID_HINT.test(m[2])) last.paidHint = true;
      }
    } else if (a.type === 'deferred_tools_delta') {
      out.found = true;
      const names = Array.isArray(a.addedLines) ? a.addedLines : (Array.isArray(a.addedNames) ? a.addedNames : []);
      out.toolNames += names.length;
      out.toolChars += names.reduce((n, s) => n + String(s).length + 1, 0);
      for (const n of names) { const m = /^mcp__plugin_([^_]+)_/.exec(String(n)); if (m) row(m[1]).tools++; }
      const auth = Array.isArray(a.needsAuthMcpServers) ? a.needsAuthMcpServers : [];
      const failed = Array.isArray(a.failedMcpServers) ? a.failedMcpServers : [];
      out.needsAuth = Math.max(out.needsAuth, auth.length);
      out.failed = Math.max(out.failed, failed.length);
      for (const s of auth) { const p = serverPlugin(s); if (p) row(p).signIn = true; }
      for (const s of failed) { const p = serverPlugin(s); if (p) row(p).failed = true; }
    } else if (a.type === 'mcp_instructions_delta') {
      out.found = true;
      const blocks = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
      out.servers += blocks.length;
      out.serverChars += blocks.reduce((n, s) => n + String(s).length, 0);
    }
  }
  return out;
}

export const pluginNames = l => Object.keys((l && l.byPlugin) || {}).filter(p => p !== STANDALONE).sort();

const facts = (p, v, allowed) => [
  `${p} ${v.skills} skill${v.skills === 1 ? '' : 's'}${v.tools ? ` + ${v.tools} tools` : ''} ~${tokens(v.chars)}t`,
  v.nameOnly ? `${v.nameOnly} name-only` : '',
  v.signIn ? (v.failed ? 'its server failed to connect' : 'waits for sign-in') : '',
  v.paidHint ? 'mentions a key, credits or billing' : '',
  allowed.includes(p) ? 'paid use allowed by the user' : '',
].filter(Boolean).join(', ');

const PAID_RULE = {
  never: 'the user said never to use skills that bill an outside service',
  ask: 'ask the user once per job before using a skill that bills an outside service',
  free: 'the user allows skills that bill an outside service',
};

// The check said to the lead when the plugin set is first seen or grows. With
// `known` (the plugin names from the last check) only new plugins are listed,
// and a set that only shrank says nothing: that was the user's choice already.
export function pluginFitLine(l, { known = null, paidMode = 'ask', paidAllowed = [], profileScript = 'profile.mjs' } = {}) {
  if (!l || !l.found) return '';
  const names = pluginNames(l);
  const fresh = known ? names.filter(p => !known.includes(p)) : names;
  if (!fresh.length) return '';
  const list = fresh.sort((a, b) => l.byPlugin[b].chars - l.byPlugin[a].chars)
    .map(p => facts(p, l.byPlugin[p], paidAllowed)).join('; ');
  const total = tokens(l.skillChars + l.toolChars + l.serverChars);
  const head = known
    ? `new plugins since the last check: ${list}.`
    : `every step re-reads ~${Math.round(total / 1000)}k tokens of listings before any work: ${l.skills} skills from ${names.length} plugins, ${l.toolNames} tool names, instructions from ${l.servers} tool servers.${l.nameOnly ? ` ${l.nameOnly} skills arrived as a bare name with no description, because too many are installed; their use cannot be judged from the listing.` : ''}${l.needsAuth || l.failed ? ` ${l.needsAuth} tool servers wait for sign-in and ${l.failed} failed to connect; they do nothing until then.` : ''} Per plugin: ${list}.`;
  const allowed = paidAllowed.length ? ` (allowed by name: ${paidAllowed.join(', ')})` : '';
  return [
    head,
    `Once, in a few lines, sort ${known ? 'the new ones' : 'them'} for the user: keep what serves the work they do or orchestrate itself; remove what is unrelated, repeats a built-in, or bills an outside service they have not allowed — ${PAID_RULE[paidMode] || PAID_RULE.ask}${allowed}. Give the rough per-step saving. Removing is their choice: plugins added to their Claude account are removed in the Claude app's plugin settings and do not show in /plugin; ones installed from a terminal are removed with /plugin.`,
    `Do not suggest installing plugins now: each one is re-read on every step. When a task later needs what the built-ins cannot do, search the plugin catalog then, name one, and say whether it bills an outside service. To let orchestrate use a paid one they bought: node "${profileScript}" --set allowPaid=<plugin>.`,
  ].join(' ');
}
