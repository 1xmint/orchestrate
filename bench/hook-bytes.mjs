// Counts what each orchestrate hook adds to Claude Code sessions.
// node bench/hook-bytes.mjs [dir]   (default: the Claude projects folder)
// Prints tag names and numbers only; no transcript text reaches the output.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAGGED = /^\[orchestrate(?: · ([^\]\n]+))?\]/;
const GUARD = /^orchestrate guard:/;

// A Stop hook that blocks is written into the session twice (read in the Claude
// Code 2.1.42 and 2.1.288 programs, which agree). One is the message the model
// reads next: a user record whose text is "Stop hook feedback:", a newline, and
// the hook's reason as it printed it. The other is a stop_hook_summary record
// that holds the same reason in hookErrors. So a reason never starts a record
// by itself: counting text that starts "orchestrate: " found no block at all,
// and the zero was blindness, not quiet. The message is what is counted, since
// its bytes are what the model re-reads; the summary is only counted apart.
const STOP_FEEDBACK = /^Stop hook feedback:\r?\n/;
// How this plugin's two Stop hooks begin a reason: persist-check.mjs (keep-going,
// the checkpoint) and turn-check.mjs write "orchestrate: ...", and persist-check.mjs
// writes "Your last message says ..." when a commit claim does not match git.
// Feedback that begins otherwise is counted apart, so reworded text of ours or
// another plugin's Stop hook shows as a number instead of vanishing.
const OURS = /^(?:orchestrate: |Your last message says )/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

function textOf(r) {
  if (r.type === "user") {
    const c = r.message?.content;
    if (typeof c === "string") return [c];
    if (Array.isArray(c)) return c.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text);
    return [];
  }
  const a = r.attachment;
  if (a && a.type !== "hook_success" && a.type !== "prompt_snapshot") {
    const c = a.content;
    if (typeof c === "string") return [c];
    if (Array.isArray(c)) return c.filter((x) => typeof x === "string");
  }
  return [];
}

export function scan(dir) {
  const tags = new Map(); // tag -> {injections, bytes, sessions:Set}
  const add = (tag, bytes, sid) => {
    const t = tags.get(tag) ?? { injections: 0, bytes: 0, sessions: new Set() };
    t.injections++;
    t.bytes += bytes;
    t.sessions.add(sid);
    tags.set(tag, t);
  };
  let sessions = 0;
  let stopBlocks = 0;
  let otherStopFeedback = 0;
  let stopSummaries = 0;
  const seen = new Set(); // resumed sessions copy earlier records; count each uuid once
  for (const file of walk(dir)) {
    sessions++;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      // A commit-claim block never says "orchestrate", so the feedback marker is a way in too.
      if (!line.includes("orchestrate") && !line.includes("stop_hook_summary") && !line.includes("Stop hook feedback")) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.uuid) { if (seen.has(r.uuid)) continue; seen.add(r.uuid); }
      if (r.type === "system" && r.subtype === "stop_hook_summary") {
        if (r.preventedContinuation === true || r.hasOutput === true) stopSummaries++;
        continue;
      }
      const isHookCtx = r.attachment?.type === "hook_additional_context";
      for (const t of textOf(r)) {
        const bytes = Buffer.byteLength(t);
        const m = TAGGED.exec(t);
        const feedback = r.type === "user" ? STOP_FEEDBACK.exec(t) : null;
        if (isHookCtx && m) add(m[1]?.trim() || "(untagged)", bytes, file);
        else if (isHookCtx && GUARD.test(t)) add("guard", bytes, file);
        else if (feedback && OURS.test(t.slice(feedback[0].length))) { stopBlocks++; add("stop-block", bytes, file); }
        else if (feedback) otherStopFeedback++;
      }
    }
  }
  const rows = [...tags].map(([tag, t]) => ({
    tag,
    injections: t.injections,
    bytes: t.bytes,
    sessionsWithTag: t.sessions.size,
    bytesPerSession: sessions ? Math.round(t.bytes / sessions) : 0,
  })).sort((a, b) => b.bytesPerSession - a.bytesPerSession || b.bytes - a.bytes || a.tag.localeCompare(b.tag));
  return { sessions, stopBlocks, otherStopFeedback, stopSummaries, rows };
}

export function format(res) {
  const out = [
    `sessions seen: ${res.sessions}`,
    `stop blocks: ${res.stopBlocks}`,
    `other Stop-hook feedback (not this plugin's wording): ${res.otherStopFeedback}`,
    `stop summaries with output or a held turn: ${res.stopSummaries}`,
    "",
    "tag | injections | total bytes | sessions with tag | bytes per session (all sessions)",
  ];
  for (const r of res.rows) out.push(`${r.tag} | ${r.injections} | ${r.bytes} | ${r.sessionsWithTag} | ${r.bytesPerSession}`);
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(os.homedir(), ".claude", "projects");
  console.log(format(scan(dir)));
}
