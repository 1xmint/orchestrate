---
type: regex
target: last_message
pattern: '```\s*mermaid|\b(graph|flowchart)\s+(TD|LR|TB|RL|BT)\b|sequenceDiagram'
match: not_contains
arm: both
---
