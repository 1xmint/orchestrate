#!/usr/bin/env bash
# Seeds a recipe-box CLI with three commits that stand for earlier sessions, a
# project page (.orchestrator/PROJECT.md) whose Next has item 1 done, and one
# open run ledger whose tasks match Next. A fourth item sits under Later.
set -euo pipefail

git init -q
git config user.email "eval@example.com"
git config user.name "eval"
mkdir -p src .orchestrator/runs/20260928-recipe-box

# --- commit 1: skeleton and storage
cat > package.json <<'EOP'
{
  "name": "recipe-box",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOP

cat > README.md <<'EOP'
# recipe-box

Keeps a list of recipes in a small JSON file (`recipes.json` in the folder you
run it from, or the file named by the `RECIPES_FILE` environment variable).

    node src/cli.js add "Pancakes" flour eggs milk
EOP

cat > src/store.js <<'EOP'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = () => process.env.RECIPES_FILE || join(process.cwd(), 'recipes.json');

export function loadRecipes() {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : [];
}

export function saveRecipes(recipes) {
  writeFileSync(file(), JSON.stringify(recipes, null, 2));
}
EOP
git add -A
git commit -q -m "session 1: skeleton and storage"

# --- commit 2: the add command
cat > src/cli.js <<'EOP'
import { loadRecipes, saveRecipes } from './store.js';

const [cmd, name, ...ingredients] = process.argv.slice(2);

if (cmd === 'add' && name) {
  const recipes = loadRecipes();
  recipes.push({ name, ingredients });
  saveRecipes(recipes);
  console.log(`added ${name}`);
} else {
  console.log('usage: add <name> <ingredient...>');
}
EOP
git add -A
git commit -q -m "session 2: add command"

# --- commit 3: project page and run ledger
cat > .orchestrator/PROJECT.md <<'EOP'
# Project page

## What this is for

A tiny recipe box for one home cook: save recipes from the terminal, then find
what to cook from what is in the cupboard.

## Where it stands

`add` works and saves to the JSON file. Nothing reads the recipes back yet.

## Next

1. Add a recipe -> `node src/cli.js add "Pancakes" flour eggs milk` saves it (done)
2. List recipes -> `node src/cli.js list` prints one line per recipe with its name and how many ingredients it has
3. Search by ingredient -> `node src/cli.js search flour` prints the names of the recipes that use flour

## Later

4. Export all recipes to a markdown file -> `node src/cli.js export recipes.md`

## Decisions

- 2026-09-28 — plain JSON file, no database — one cook, a few dozen recipes — easy to swap later

## Open questions for the owner

- none

## Earlier research

- none
EOP

cat > .orchestrator/runs/20260928-recipe-box/RUN.md <<'EOP'
# Run 20260928-recipe-box

Started 2026-09-28. The ledger for one goal.

## Goal

Make the recipe box useful enough to cook from: add, list and search recipes.

Why it matters: the cook can find a recipe without opening the JSON file.

## Where this sits

Brief: none yet
Roadmap: .orchestrator/PROJECT.md
This run serves: the first three steps of Next on the project page.
Direction checked: never

## Done when

- `node src/cli.js add` saves a recipe (already true).
- `node src/cli.js list` prints each recipe's name and ingredient count.
- `node src/cli.js search <ingredient>` prints the names of recipes that use it.
- Stops anyway when: the three commands work or the user redirects.
- When it ends, met or dropped: `run-init.mjs --close <run id> --reason "…"`, or every new session in this repo is told it continues this run.

## Constraints and non-goals

- constraint: plain JSON storage through src/store.js
- not doing: export, which is under Later on the project page

## Approach

Current approach: one small command per task, each in src/cli.js, reading through src/store.js.
Next deliverable: the list command.

## Budget

Ceiling: none · sessions: ~3 fresh sessions · set 2026-09-28

## Shape

tasks: 3 · at once: 1 · models: lead alone · why not smaller: it is already three small steps

## Profile

tier: subscription · host: claude-code · providers: anthropic

## Facts learned while grounding

- src/store.js exports loadRecipes and saveRecipes; src/cli.js dispatches on the first argument.

## Tasks

| id | phase | blocks on | owns | role · model | task | acceptance evidence | attempts | result |
|---|---|---|---|---|---|---|---|---|
| 9-28-0001 | ✅ done | — | src/cli.js | lead | add command | add saves a recipe to the JSON file | 1 | done in session 2 |
| 9-28-0002 | 📋 planned | — | src/cli.js | lead | list command | list prints name and ingredient count per recipe | 0 | — |
| 9-28-0003 | 📋 planned | — | src/cli.js | lead | search command | search flour prints the names of recipes using flour | 0 | — |

Phases: 📋 planned · 🔨 running · 🔍 review · ✅ done · 🧱 built-unverified · ◐ partial · ⛔ blocked · ✖ failed
Ids: `9-28-NNNN`, counter from 0001 for this run, never reused or changed.

## Decisions

- 2026-09-28 — one run for steps 1 to 3 only — step 4 is a separate wish, not part of this goal — folding it in would grow the run

## Open questions for the user

- none

## Pickup

Pickup prompt: Do the list command, then the search command.
Pickup confidence: high
Resume risk: none

## Verified vs inherited

Verified directly: add saves a recipe (ran it once in session 2).
Inherited, unverified: none
Not run: list and search, not built yet
EOP

git add -A
git commit -q -m "session 3: project page and run ledger"
