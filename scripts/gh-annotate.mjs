// gh-annotate.mjs — a node:test reporter that turns each failing test into a
// GitHub check annotation. scripts/test.mjs adds it beside the normal output
// only when GITHUB_ACTIONS is set.
//
// Why: a red CI run otherwise says only "exit code 1", and the full log sits
// behind a separate download that a phone, a reviewer, or a session that can
// reach the GitHub API but not GitHub's log storage cannot always open. The
// annotation carries the test's name, file and message onto the check itself.

import { relative } from 'node:path';

const MAX_MESSAGE = 900;

// GitHub's workflow-command escaping: the message part needs %, CR and LF
// escaped; a property value also needs : and ,.
const escapeData = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = s => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

// One annotation line for one failed test, or null when the failure only says
// that a child test failed (the child gets its own line).
export function annotation(data, cwd = process.cwd()) {
  const err = data && data.details && data.details.error;
  if (err && err.failureType === 'subtestsFailed') return null;
  const inner = err && err.cause && typeof err.cause === 'object' ? err.cause : err;
  let message = (inner && (inner.message || String(inner))) || 'failed';
  if (message.length > MAX_MESSAGE) message = message.slice(0, MAX_MESSAGE) + ' …';
  const file = data.file ? relative(cwd, data.file.replace(/^file:\/\//, '')).replace(/\\/g, '/') : '';
  const props = [];
  if (file) props.push(`file=${escapeProp(file)}`);
  if (file && data.line) props.push(`line=${data.line}`);
  props.push(`title=${escapeProp(String(data.name || 'test').slice(0, 200))}`);
  return `::error ${props.join(',')}::${escapeData(message)}\n`;
}

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const line = annotation(event.data);
    if (line) yield line;
  }
}
