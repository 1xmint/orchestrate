# Project page

## What this is for

A notes app for a small bakery: staff write down orders and the owner reads them on a phone.
Brief: "What this is for" in AGENTS.md.

## Where it stands

Orders can be added and listed. Search and the phone layout are not done. The test suite passes.

## Next

1. Add a search box to the orders page → typing a customer name narrows the list
2. Make the orders page fit a phone → it reads without sideways scrolling at phone width
3. Export orders for the accountant → a button downloads a spreadsheet of this month's orders

## Decisions

Newest ten here, older ones in .orchestrator/decisions-archive.md.

- 2026-09-28 — keep orders in one local file, not a database — one shop, under a thousand orders a year — a move to a database later costs about a day
- 2026-09-29 — no sign-in for now — it runs on the shop's own computer — anyone with the computer can see orders

## Open questions for the owner

- Should the spreadsheet show prices, or only items and quantities?

## Earlier research

- docs/research/0001-export-formats.md
