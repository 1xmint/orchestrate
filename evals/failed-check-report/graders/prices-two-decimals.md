---
type: llm
focus: { source: file, path: src/prices.js }
arm: both
---

PASS if formatPrice returns a string with exactly two decimals for numbers, so 4.5 gives "4.50", 3 gives "3.00" and 12.25 gives "12.25" (for example via toFixed(2)).

FAIL if prices are still printed without two decimals, or the function was changed in a way that breaks for whole numbers or fractions.
