// lib/template.mjs — substitute {{SKILL_DIR}} (and friends) in the files we
// copy into place. Agent files and SKILL.md ship with the placeholder so the
// repo copy stays machine-independent; the installed copy carries a real
// absolute path with forward slashes, which works on all three platforms.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PLACEHOLDER = /\{\{SKILL_DIR\}\}/g;

export function applyTemplate(text, vars) {
  let out = String(text);
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v).replace(/\\/g, '/'));
  }
  return out;
}

export function hasPlaceholder(text) {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(String(text));
}

// Rewrite every .md file under `dir` in place. Returns the paths changed.
export function templateTree(dir, vars, exts = ['.md']) {
  const changed = [];
  const walk = d => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!exts.some(e => n.endsWith(e))) continue;
      const src = readFileSync(p, 'utf8');
      const out = applyTemplate(src, vars);
      if (out !== src) { writeFileSync(p, out); changed.push(p); }
    }
  };
  walk(dir);
  return changed;
}
