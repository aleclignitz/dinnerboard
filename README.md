# Dinnerboard

A self-hosted fork of [Supper Board](https://github.com/weezerhunter/Supper-Board) - a shared kitchen board for a household's meal plan, grocery list, and freezer/staples tracking.

The original project runs entirely inside a Claude artifact (page, database, and scheduled automation). This version swaps that out for free/cheap infrastructure you control:

| Piece | Original | Here |
|---|---|---|
| Shared database | Claude artifact `db` | [Supabase](https://supabase.com) Postgres table |
| Hosting | Claude artifact link | GitHub Pages (`docs/`) |
| Weekly automation | Claude scheduled tasks | GitHub Actions (cron) |
| Plan/recipe writing | Claude, in-artifact | Claude API, called from Actions |
| Sign-in / sharing | Claude account, Editor access | Supabase Auth (magic link) |
| Shopping hand-off | Copy list button, or Muse/agent | Unchanged - still the Copy list button |

## Status: basic

This is a first pass, kept intentionally simple:
- No Tom Thumb (or other store) weekly-ad reading yet.
- No Gmail order-check or Google Doc export - the grocery list is saved straight to the board behind **Copy list**.
- Recipes are still written by the Claude API each week, not pulled from a fixed dataset - [data/recipes.json](data/recipes.json) is a placeholder for that later.

## Repo layout

```
board/supper-board.html     The board's UI (unmodified fragment, same as upstream)
board/config.js             Supabase project URL + publishable key (fill in)
board/supabase-adapter.js   Implements the board's expected db/user API on top of Supabase
docs/                       Generated static site - what GitHub Pages actually serves
tools/build_board.py        Rebuilds docs/ from board/ after any change
sql/schema.sql              The `documents` table, Row Level Security, realtime
scripts/plan-draft.mjs      Tuesday job: promotes a due draft, writes the next plan
scripts/grocery-list.mjs    Thursday job: finalizes swaps, builds the grocery list
scripts/lib/                Supabase + Claude API helpers used by the two jobs above
.github/workflows/          The two scheduled GitHub Actions
data/recipes.json           Placeholder for a future fixed recipe dataset
```

## Setup

1. **Supabase**: create a project, run [sql/schema.sql](sql/schema.sql) in the SQL editor, and confirm `documents` is enabled for realtime (Database → Replication).
2. **Keys**: in Supabase, go to Settings → API Keys. Put the project URL and **publishable key** (`sb_publishable_...`) in [board/config.js](board/config.js) - safe to commit, it's restricted by RLS. Keep the **secret key** (`sb_secret_...`) out of this repo entirely; it only goes into GitHub Actions secrets.
3. **Build the site**: `python tools/build_board.py` whenever `board/` changes, then commit `docs/`.
4. **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / `docs`.
5. **GitHub Actions secrets** (Settings → Secrets and variables → Actions): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`.
6. **GitHub Actions variables** (same screen, Variables tab): `PLAN_GUIDELINES`, `STORE_NAME`, `SUBSTITUTION_RULES`.
7. **Seed data**: insert your current `meals`, `staples`, `freezer`, and `plan/current` (with `guidelines`) rows into the `documents` table before the first scheduled run.
8. **Sign in** once on the deployed board via the magic-link prompt before testing.
9. **Test manually** first via Actions → workflow_dispatch, rather than waiting on the cron schedule.

## Credit

Design, data model, and the original two-week planning workflow are from [Supper Board](https://github.com/weezerhunter/Supper-Board) by weezerhunter, MIT licensed. This repo re-implements its automation on different infrastructure; the board's look and data shape are unchanged.
