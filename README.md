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
- Cook-night recipes are picked deterministically from the Supabase `recipes` dataset (see below) and reviewed/annotated by Claude, with free-form generation only as a fallback when nothing in the dataset fits. Flex nights with a specific dish are still fully Claude-written.

## Repo layout

```
board/supper-board.html     The board's UI (unmodified fragment, same as upstream)
board/config.js             Supabase project URL + publishable key (fill in)
board/supabase-adapter.js   Implements the board's expected db/user API on top of Supabase
docs/                       Generated static site - what GitHub Pages actually serves
tools/build_board.py        Rebuilds docs/ from board/ after any change
tools/import_recipes.py     Converts an nyt-cooking-parser sqlite export into a staging JSON file
sql/schema.sql              The `documents` table + `recipes` table, Row Level Security, realtime
scripts/plan-draft.mjs      Tuesday job: promotes a due draft, writes the next plan
scripts/grocery-list.mjs    Thursday job: finalizes swaps, builds the grocery list
scripts/load-recipes.mjs    One-off job: bulk-upserts the staging JSON into Supabase's recipes table
scripts/lib/recipePicker.mjs  Deterministic candidate picker + Claude accept/reject review + thaw instructions
scripts/lib/                Supabase + Claude API helpers used by the jobs above
.github/workflows/          The two scheduled GitHub Actions
```

## Setup

1. **Supabase**: create a project, run [sql/schema.sql](sql/schema.sql) in the SQL editor, and confirm `documents` is enabled for realtime (Database → Replication).
2. **Keys**: in Supabase, go to Settings → API Keys. Put the project URL and **publishable key** (`sb_publishable_...`) in [board/config.js](board/config.js) - safe to commit, it's restricted by RLS. Keep the **secret key** (`sb_secret_...`) out of this repo entirely; it only goes into GitHub Actions secrets and your local `.env`.
3. **Build the site**: `python tools/build_board.py` whenever `board/` changes, then commit `docs/`.
4. **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / `docs`.
5. **GitHub Actions secrets** (Settings → Secrets and variables → Actions): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`.
6. **GitHub Actions variables** (same screen, Variables tab): `PLAN_GUIDELINES`, `PLAN_MAX_COOK_MINUTES`, `STORE_NAME`, `ORDER_METHOD` (`pickup` or `delivery`, defaults to `delivery`), `SUBSTITUTION_RULES`.
7. **Seed data**: insert your current `meals`, `staples`, `freezer`, and `plan/current` (with `guidelines`) rows into the `documents` table before the first scheduled run.
8. **Sign in** once on the deployed board via the magic-link prompt before testing.
9. **Test manually** first via Actions → workflow_dispatch, rather than waiting on the cron schedule.

## Recipe dataset

Recipes live in Supabase's `recipes` table (added by [sql/schema.sql](sql/schema.sql)), ported from the sqlite db produced by the separate nyt-cooking-parser project (`data/db/recipes.db` there, built with its `recipes`/`tags`/`recipe_tags` tables). Each row has `title`, `url`, `description`, `tags`, `rating`, `rating_count`, a derived `course` (`entree` / `side` / `other`) and `protein` (`chicken` / `beef` / `pork` / `turkey` / `lamb` / `fish` / `vegetarian` / `null`, both guessed from tags at import time), plus the board's recipe shape (`serves`, `time_minutes`, `oven`, `ingredients`, `steps`, `tip`).

> If you created the `recipes` table before `course`/`protein` existed, add them with:
> ```sql
> alter table recipes add column if not exists course text not null default 'other';
> alter table recipes add column if not exists protein text;
> ```

To load (or refresh) the dataset:

```
python tools/import_recipes.py <path-to-recipes.db> .recipes-staging.json
node --env-file=.env scripts/load-recipes.mjs .recipes-staging.json
```

The staging JSON is gitignored - it's a local intermediate file, not committed. The load step upserts by `id`, so re-running it after re-scraping more recipes is safe.

## How recipes get picked

For every `cook` night, [scripts/plan-draft.mjs](scripts/plan-draft.mjs) (and [scripts/grocery-list.mjs](scripts/grocery-list.mjs) for swap replacements) runs [scripts/lib/recipePicker.mjs](scripts/lib/recipePicker.mjs):

1. Claude first drafts the two-week skeleton (dates, kind, a target `protein` per cook night for variety) - no recipe content yet.
2. `pickCandidates` deterministically queries Supabase for up to 10 `course = 'entree'` matches (protein, `time_minutes <= PLAN_MAX_COOK_MINUTES`, `rating >= 4`), excluding recipes already used in recent history or earlier in this draft. Sort order (rating desc, id asc) makes it reproducible for a given db state and exclude set. If nothing matches, it progressively relaxes the rating floor, then the time cap, then the protein requirement.
3. Claude reviews that shortlist against guidelines, history, freezer and staples, and either accepts one (writing `details` and `thaw` instructions) or rejects the whole batch with a reason. On rejection the picker excludes those ids and tries again (up to 3 rounds total).
4. If nothing is ever accepted, `generateFreeformRecipe` falls back to the original from-scratch Claude recipe generation, so a meal is never left without a recipe.

`sourceRecipeId` is saved on each meal doc so future runs can exclude already-used recipes from history.

## Credit

Design, data model, and the original two-week planning workflow are from [Supper Board](https://github.com/weezerhunter/Supper-Board) by weezerhunter, MIT licensed. This repo re-implements its automation on different infrastructure; the board's look and data shape are unchanged.
