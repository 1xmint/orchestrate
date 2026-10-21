import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan, format } from "./hook-bytes.mjs";
import { persistDecision } from "../skills/orchestrate/scripts/persist-check.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "hook-bytes");
const res = scan(dir);
const row = (tag) => res.rows.find((r) => r.tag === tag);
const bytes = (s) => Buffer.byteLength(s);

test("counts injections and bytes per tag, skipping the duplicate hook_success stdout and repeated uuids", () => {
  assert.equal(res.sessions, 2);
  // two size injections in one.jsonl; the same uuid copied into two.jsonl and the hook_success stdout are skipped
  assert.equal(row("size").injections, 2);
  assert.equal(row("size").bytes, bytes("[orchestrate · size] SECRETWORD aaaa") + bytes("[orchestrate · size] bb"));
  assert.equal(row("size").sessionsWithTag, 1);
  assert.equal(row("size").bytesPerSession, Math.round(row("size").bytes / 2));
  assert.equal(row("context").injections, 1);
  assert.equal(row("(untagged)").injections, 1);
  assert.equal(row("guard").injections, 1);
});

// What Claude Code writes when a Stop hook blocks: a user record whose text is
// "Stop hook feedback:", a newline, then the hook's reason. The fixture holds
// the two ways this plugin's Stop hooks begin a reason.
const KEEP_GOING = 'Stop hook feedback:\norchestrate: "SECRETWORD goal" · next open item: finish b';
const COMMIT_CLAIM = "Stop hook feedback:\nYour last message says nothing is committed; git status shows a clean tree. A reply to this block becomes the report the user sees. SECRETWORD";

test("counts Stop-hook blocks from the host's feedback record, whatever the reason starts with", () => {
  // A keep-going hand-back and a commit-claim one. The second line never says
  // "orchestrate", so it only counts if the feedback marker lets the line in.
  assert.equal(res.stopBlocks, 2);
  assert.equal(row("stop-block").injections, 2);
  assert.equal(row("stop-block").bytes, bytes(KEEP_GOING) + bytes(COMMIT_CLAIM));
  assert.equal(row("stop-block").sessionsWithTag, 1);
  // The same keep-going record copied into two.jsonl (a resumed session) is not
  // a second block, and the summary's hookErrors holding its reason is not a third.
  assert.equal(res.rows.length, 5);
});

test("feedback that does not begin the way this plugin's hooks do is counted apart, and a quoted record is not a block", () => {
  // Another plugin's Stop hook (or ours reworded) shows as a number. The
  // record that only quotes the marker mid-sentence is chat, not feedback.
  assert.equal(res.otherStopFeedback, 1);
});

test("counts Stop summaries with output apart from blocks, and not skill listings or chat", () => {
  assert.equal(res.stopSummaries, 1);
  assert.equal(row("skill"), undefined);
});

test("the reason the keep-going hook really writes is counted when the host wraps it as feedback", () => {
  // Built from the hook's own decision, so a change to how it begins a reason
  // fails here instead of turning the count back into a blind zero.
  const dec = persistDecision({
    rec: {},
    scan: { progressed: true, denied: false, errors: [], asked: false, goalMet: false, tools: 3, lastChange: "a.js" },
    goal: "ship the widget",
    next: { state: "open", text: "wire the button" },
  });
  assert.equal(dec.kind, "continue");
  const text = `Stop hook feedback:\n${dec.why}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
  try {
    const rec = { type: "user", uuid: "x1", isMeta: true, message: { role: "user", content: text } };
    fs.writeFileSync(path.join(tmp, "s.jsonl"), JSON.stringify(rec) + "\n");
    const r = scan(tmp);
    assert.equal(r.stopBlocks, 1);
    assert.equal(r.otherStopFeedback, 0);
    assert.equal(r.rows.find((x) => x.tag === "stop-block").bytes, bytes(text));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("ranks by bytes per session", () => {
  const v = res.rows.map((r) => r.bytesPerSession);
  assert.deepEqual(v, [...v].sort((a, b) => b - a));
});

test("no transcript text other than tag names reaches the output", () => {
  const out = format(res);
  for (const leak of ["SECRETWORD", "aaaa", "untagged text", "next open item", "Your last message", "lint found", "why did I see", "no PROGRESS", "ordinary"]) {
    assert.ok(!out.includes(leak), leak);
  }
});
