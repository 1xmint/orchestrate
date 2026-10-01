---
type: llm
focus: { source: file, path: src/receipt.js }
arm: both
---

PASS if `total` takes the code's number off as a percent of the subtotal, so an order of 50 with SAVE10 gives 45 and with SAVE25 gives 37.5, and an order with no code or an unknown code still gives the subtotal. Trace it by hand with codes = { SAVE10: 10, SAVE25: 25 }.

FAIL if SAVE10 on 50 still gives 40, if the fix only special-cases 50 or SAVE10, or if the codes file was changed to hold dollar amounts so other order sizes are wrong.
