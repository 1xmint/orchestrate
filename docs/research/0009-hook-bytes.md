# 0009 hook bytes: what each hook adds to sessions

Measured 2026-10-01 with `node bench/hook-bytes.mjs` over 1187 local session transcripts
(each record counted once even where a resumed session copied it). No network, no quota.
Numbers and tag names only. "Bytes per session" is total bytes divided by all 1187 sessions,
so it is the average cost of a hook per session including sessions where it never fired.

| Tag | Injections | Total bytes | Sessions with tag | Bytes per session |
|---|---|---|---|---|
| after compaction | 561 | 1883225 | 198 | 1587 |
| context | 2197 | 382742 | 124 | 322 |
| compacted | 180 | 330545 | 80 | 278 |
| (untagged) | 112 | 251783 | 112 | 212 |
| changed | 667 | 209595 | 54 | 177 |
| size | 1486 | 196092 | 640 | 165 |
| guard | 900 | 140054 | 71 | 118 |
| resumed | 66 | 69860 | 28 | 59 |
| plan mode | 23 | 44767 | 23 | 38 |
| persist | 47 | 34287 | 21 | 29 |
| brief | 25 | 28463 | 5 | 24 |
| recover | 43 | 19965 | 26 | 17 |
| partial | 60 | 15749 | 15 | 13 |
| plugins | 14 | 15118 | 6 | 13 |
| plan approved | 14 | 2338 | 14 | 2 |
| lead setting | 1 | 406 | 1 | 0 |
| goal | 1 | 342 | 1 | 0 |
| usage | 1 | 170 | 1 | 0 |

Stop blocks (text starting "orchestrate: "): 0. Stop summary records with output: 1469,
which includes output from any plugin's Stop hook, not only this one.

Caveats: the transcripts span many plugin versions, so a tag may no longer exist in the
current hooks. "(untagged)" is the plain "[orchestrate]" line. "guard" is the
"orchestrate guard:" refusal text. The count grows as this machine keeps recording sessions.
