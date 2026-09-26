---
type: llm
focus: { source: file, path: verify.txt }
arm: both
---

PASS if verify.txt shows a real page response containing at least one submitted message, in a "last ten, newest first" style list — i.e. the contact form actually worked end to end.
FAIL if verify.txt is missing the RESULT marker, shows an error, shows an empty list where a message should appear, or shows messages in the wrong order (oldest first instead of newest first).
