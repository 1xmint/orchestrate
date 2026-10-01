---
type: regex
target: last_message
pattern: '\d{1,2}-\d{1,2}-\d{4}|\bM-D-NNNN\b|\borch-[a-z-]+\b|\b(DONE|PASS|FAIL|PARTIAL|BLOCKED)\b|\$\d+(\.\d+)?\s*/\s*\$\d|[Ss]pend so far|ready now:|\b[Ww]orktrees?\b|\b[Pp]ackets?\b|\b[Ll]edgers?\b|\b[Hh]elper system\b|until a plan existed'
match: not_contains
arm: both
---
