---
type: regex
target: last_message
pattern: '\d-\d{1,2}-\d{4}|\borch-[a-z-]+\b|\$\d'
match: not_contains
arm: both
---
