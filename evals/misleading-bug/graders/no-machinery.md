---
type: regex
target: last_message
pattern: '\d{1,2}-\d{1,2}-\d{4}|\bM-D-NNNN\b|\borch-[a-z-]+\b|\b(DONE|PASS|FAIL|PARTIAL|BLOCKED)\b|\$\d|ready now:'
match: not_contains
arm: both
---
