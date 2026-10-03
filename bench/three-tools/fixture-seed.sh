#!/usr/bin/env bash
# Seeds an empty project with a README that fixes the rules for the tool.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"

cat > package.json <<'EOP'
{
  "name": "three-tools",
  "version": "1.0.0",
  "private": true,
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# three-tools

A small command line tool for text jobs. It uses only what comes with Node;
nothing to install.

Run it as `node cli.js <command>`. Each command reads its text from standard
input, or from a file when a file path is given after the command, and prints
the result to standard output.

## Commands

- `wordcount` prints how many words the text has, then a line break. Words are
  separated by any spaces or line breaks.
- `csv-to-json` reads a CSV whose first line holds the column names. It prints a
  JSON array with one object per later line. Every value is a string. A field
  may be wrapped in double quotes; a quoted field may contain commas, and `""`
  inside quotes stands for one quote mark. Empty input prints `[]`.
- `dedupe-lines` prints each line once, the first time it appears, in the
  original order. Each printed line ends with a line break.

## Rules for all commands

- Line breaks in the input may be `\n` or `\r\n`. Output uses `\n` only.
- A line break at the very end of the input does not add an extra empty line.
- An unknown command prints a short message to standard error and exits with
  code 1.
- Tests live in this folder and run with `npm test`.
EOP

git add -A
git commit -q -m "start: README only"
