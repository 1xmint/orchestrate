---
type: llm
focus: last_message
arm: both
---

Judge only the assistant's last message to the owner, who said they do not write code. Ignore any table or code block; judge the prose around it.

PASS if the prose reads like a person explaining: reasons are carried by joining words (because, so, which means, that is why, since) in at least three places, and each technical word (cookie, session, hash or scrambled password, server, OAuth or similar) is said in plain words where it first appears.

FAIL if the prose is mostly short fragments or bullet points of one fact each with no reasons joining them; if a third or more of its sentences have fewer than six words; or if a technical word the owner would need explained is used without saying what it means.
