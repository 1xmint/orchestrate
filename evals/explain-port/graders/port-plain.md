---
type: llm
focus: last_message
arm: both
---

Judge only the assistant's last message to the owner.

PASS if its first sentence gives the port, 4321 (saying the address http://localhost:4321 counts), and the whole message is short: a few sentences at most.

FAIL if the port is not in the first sentence; if the message contains a table, a text sketch or diagram, or a Mermaid block; or if it runs past about 80 words of explanation the owner did not ask for.
