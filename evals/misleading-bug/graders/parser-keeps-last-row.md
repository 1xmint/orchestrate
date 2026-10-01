---
type: llm
focus: { source: file, path: src/parser.js }
arm: both
---

PASS if this parser, run on a CSV whose last line has no trailing newline, keeps every data row after the header (including the last one). Tracing it by hand on `date,amount\n2026-09-14,120` must give one row with amount 120.

FAIL if the parser still drops the final line when there is no trailing newline (for example it still cuts the last element off unconditionally), or if it returns rows that are not data rows (such as a blank entry that becomes NaN).
