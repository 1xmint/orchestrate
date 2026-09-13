// lib/listing.mjs — what the host re-sends on every step before any work.
//
// Every enabled plugin puts a line per skill (name and description), its tool
// names and its tool servers' instructions into the context of every step of
// every session. One session on this machine started each step at ~75k tokens,
// ~20k of it these listings, most from plugins unrelated to the work. Only the
// user can turn a plugin off, so this reports the facts and leaves the judgment
// of what is unrelated to the model and the choice to the user.
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

const pluginOf = name => (String(name).includes(':') ? String(name).split(':')[0] : '(standalone)');

export function parseListing(text) {
  const out = { found: false, skills: 0, skillChars: 0, byPlugin: {}, toolNames: 0, toolChars: 0, servers: 0, serverChars: 0, needsAuth: 0, failed: 0 };
  for (const line of String(text || '').split('\n')) {
    if (!/"attachment"/.test(line) || !/skill_listing|deferred_tools_delta|mcp_instructions_delta/.test(line)) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const a = r && r.type === 'attachment' && r.attachment;
    if (!a) continue;
    if (a.type === 'skill_listing' && typeof a.content === 'string') {
      out.found = true;
      out.skills = Number(a.skillCount) || (Array.isArray(a.names) ? a.names.length : 0);
      out.skillChars += a.content.length;
      for (const l of a.content.split('\n')) {
        const m = /^-\s+([^\s:]+(?::[^\s:]+)?):?/.exec(l);
        if (!m) continue;
        const p = pluginOf(m[1]);
        const row = out.byPlugin[p] || (out.byPlugin[p] = { skills: 0, chars: 0 });
        row.skills++; row.chars += l.length + 1;
      }
    } else if (a.type === 'deferred_tools_delta') {
      out.found = true;
      const names = Array.isArray(a.addedLines) ? a.addedLines : (Array.isArray(a.addedNames) ? a.addedNames : []);
      out.toolNames += names.length;
      out.toolChars += names.reduce((n, s) => n + String(s).length + 1, 0);
      out.needsAuth = Math.max(out.needsAuth, Array.isArray(a.needsAuthMcpServers) ? a.needsAuthMcpServers.length : 0);
      out.failed = Math.max(out.failed, Array.isArray(a.failedMcpServers) ? a.failedMcpServers.length : 0);
    } else if (a.type === 'mcp_instructions_delta') {
      out.found = true;
      const blocks = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
      out.servers += blocks.length;
      out.serverChars += blocks.reduce((n, s) => n + String(s).length, 0);
    }
  }
  return out;
}

export function listingLine(l, top = 6) {
  if (!l || !l.found) return '';
  const total = tokens(l.skillChars + l.toolChars + l.serverChars);
  const plugins = Object.entries(l.byPlugin).filter(([p]) => p !== '(standalone)');
  const largest = plugins.sort((a, b) => b[1].chars - a[1].chars).slice(0, top)
    .map(([p, v]) => `${p} ${v.skills} skills (~${tokens(v.chars)} tokens)`).join(', ');
  const parts = [
    `every step re-reads ~${Math.round(total / 1000)}k tokens of listings before any work: ${l.skills} skills from ${plugins.length} plugins (~${Math.round(tokens(l.skillChars) / 1000)}k), ${l.toolNames} tool names (~${Math.round(tokens(l.toolChars) / 1000)}k), instructions from ${l.servers} tool servers (~${Math.round(tokens(l.serverChars) / 1000)}k).`,
    largest ? `Largest: ${largest}.` : '',
    l.needsAuth || l.failed ? `${l.needsAuth} tool servers are waiting for sign-in and ${l.failed} failed to connect; they are listed but do nothing.` : '',
    'Once, in a sentence or two, tell the user which of these look unrelated to their work: turning a plugin off in the Claude app\'s plugin settings (or /plugin in a terminal) removes its share from every step, and they can turn one back on when a job needs it. Name any that call a paid outside service first if the user has said never to use those.',
  ];
  return parts.filter(Boolean).join(' ');
}
