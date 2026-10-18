I run a tiny lending shelf for the books in our office and I want a small
command line tool to keep track of them. The folder has a package.json and a
README and nothing else. Please build it in plain Node with no installed
packages. The tool is `node shelf.js <command>`, and it keeps its records in a
JSON file. The file's location comes from the SHELF_FILE environment variable
(use ./shelf.json when that is not set). Every command that cares about the
date accepts `--today YYYY-MM-DD` so I can try things on any day; without it,
use the real date.

I haven't decided how late fees work yet: what a day late costs, and whether
there is a most a person can owe. Ask me when you get to that part and I will
tell you. Please don't guess.

Done when:
1. `add "<title>" "<author>"` saves a book, gives it the next number starting
   at 1, and prints `added <number>`. `list` prints one line per book with its
   number, title and author, and says `available` or `checked out to <name>`.
2. `checkout <number> "<name>"` lends a book out and `return <number>` brings
   it back. Lending a book that is already out, returning one that is not out,
   or using a number that does not exist prints a message and exits with code 1.
3. A book is due 14 days after the day it was checked out. `list` shows
   `due YYYY-MM-DD` on books that are out. `overdue` lists the number and title
   of each book whose due date is before today.
4. `fee <number>` prints what is owed on that book as `$X.XX` using the late
   fee rules I give you, and `$0.00` when the book is not late or not out.
5. `stats` prints four lines: `total: N`, `available: N`, `out: N` and
   `overdue: N`.
