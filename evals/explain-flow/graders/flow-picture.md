---
type: llm
focus: last_message
arm: both
---

Judge only the assistant's last message to the owner.

PASS if the message contains one small picture of how login works: a table, or a text sketch inside a code block, that names at least three parts of the login in their order (for example the form, the password check against users.json, the cookie or ticket the browser keeps, the members page), with each box, row or step labelled in plain words, and at least one sentence of prose that explains it in the owner's words.

FAIL if there is no table or sketch at all; if the picture has unlabelled boxes or arrows only; if it merely repeats one sentence of the prose in another shape; if it is a Mermaid block or written in a diagram language; or if there are three or more separate pictures, which turns an explanation into a slideshow.
