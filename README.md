# Dinnerboard

A self-hosted fork of [Supper Board](https://github.com/weezerhunter/Supper-Board): a shared kitchen board for a household's meal plan, grocery list, and freezer/staples tracking. Each week, GitHub Actions fetch Tom Thumb's sale ad, draft a one-week dinner plan biased toward sale proteins, and build the grocery list.

The original project runs entirely inside a Claude artifact. This version uses infrastructure you control:

| Piece | Original | Here |
|---|---|---|
| Shared database | Claude artifact `db` | [Supabase](https://supabase.com) Postgres |
| Hosting | Claude artifact link | GitHub Pages (`docs/`) |
| Weekly automation | Claude scheduled tasks | GitHub Actions (cron) |
| Plan/recipe writing | Claude, in-artifact | Claude API, called from Actions |
| Sign-in / sharing | Claude account | Supabase Auth (magic link) |
| Shopping hand-off | Copy list button | Unchanged |

**Status: basic.** There is no Gmail order-check or Google Doc export; the grocery list is saved to the board behind **Copy list**.

## Weekly workflow

Two board **Settings** control the weekly cadence: **Plan day** (default Wednesday) is the day Claude drafts next week's plan, and **Delivery day** (default Thursday) is the day groceries arrive. The grocery list is always built the night before delivery, and the plan's first cook night is always the day after delivery (so there's time to put things away before cooking). The Tom Thumb ad fetch stays fixed to Wednesday morning regardless of these settings, since that's when the ad actually publishes. `plan-draft.yml` and `grocery-list.yml` now run **daily** and check these settings themselves, so changing either day only requires editing Settings on the board, not the GitHub Actions cron schedules. Every job first checks `settings/automation.enabled` in Supabase, which the **Settings** tab's automation switch sets. It is **off by default**, and when off no job calls Anthropic.

| Time (CDT) | Workflow | What happens | Anthropic calls |
|---|---|---|---|
| 6:00 AM | `fetch-weekly-ad.yml` | Fetches this week's Tom Thumb ad and writes it to `ads/current` (always Wednesday) | Optional coupon cleanup (1 call), or about 4 if the fallback scraper runs |
| 7:00 AM daily | `plan-draft.yml` | Promotes a due draft every day; on the configured **plan day** also writes next week's plan (delivery day + 1 through 6 days later) with sale-biased protein picks | 1 plan call, then 1 to 3 review calls per cook night |
| ~11:45 PM daily | `grocery-list.yml` | On the night before the configured **delivery day**, applies swaps, merges ingredients, and builds the grocery list and coupons-to-clip (or builds it earlier when you press **Confirm plan & build list now**) | 1 pantry-trim call, plus 1 to 3 review calls per swapped meal |

For example, to plan on Friday with delivery on Saturday (and cooking starting Sunday), set **Plan day** to Friday and **Delivery day** to Saturday on the Settings tab.

### 1. Weekly ad (6:00 AM)

```
Flipp JSON ──► normalize ──► [Claude: coupon cleanup, optional] ──► ads/current
   │ fails (no flyer, expired, blocked, bad shape)
   ▼
Playwright scraper ──► [Claude: structure deal text] ──► ads/current
   │ fails
   ▼
ads/current = { ok: false, error }   (job fails; the plan still runs without sale bias)
```

- **Primary: Flipp** ([scripts/fetch-flipp-ad.mjs](scripts/fetch-flipp-ad.mjs), [scripts/lib/flipp.mjs](scripts/lib/flipp.mjs)). Plain HTTP to Flipp's undocumented `backflipp.wishabi.com` endpoints, with no browser and no login. It picks the Tom Thumb "Weekly Ad" flyer for `TOM_THUMB_ZIP` that is current (or starts within 3 days) and rejects expired flyers. It then reads each item's details (price, "member price", "lb"/"ea", "2 for", limits), dedupes them, and sorts them by protein using keywords (no Claude).
- **Claude, coupons only:** a single call that tidies the coupon list, covering digital coupons, whole-order savings like "$10 off $75", and multibuy promotions. It runs only when `ANTHROPIC_API_KEY` is set and `FLIPP_CLAUDE` is not `0`. If the call fails, the keyword-based coupons are kept.
- **Fallback: Playwright** ([scripts/fetch-weekly-ad.mjs](scripts/fetch-weekly-ad.mjs)). It runs only if Flipp fails (Chromium is installed only then). It opens tomthumb.com with a saved session, reads the ad tiles, and has Claude turn the raw text into structured JSON in batches of 60. See [Fallback scraper](#fallback-scraper-playwright).
- **Safeguards:** a newer Flipp flyer is never replaced by an older one. If a fetch fails and the existing `ads/current` is still unexpired, it is kept. Otherwise `ok: false` is written, so expired deals are never used silently.

### 2. Plan draft (7:00 AM, plan day) - [scripts/plan-draft.mjs](scripts/plan-draft.mjs)

1. **Claude** drafts the one-week skeleton starting the day after delivery: dates, night type, and a target protein per cook night (using sale proteins from `ads/current` when `ok`). The default rhythm is cook every other night with leftovers between, and a flexible last night. Plans are one week because the weekly ad's fresh produce and sales don't last longer; guidelines can override the rhythm. Meals Claude dates outside the week are dropped.
2. For each cook night, [scripts/lib/recipePicker.mjs](scripts/lib/recipePicker.mjs) picks a recipe (see [How recipes get picked](#how-recipes-get-picked)): a deterministic Supabase query, then a **Claude** review of the shortlist.
3. The plan is saved as a draft on the board for review.

### 3. Review window and grocery list - [scripts/grocery-list.mjs](scripts/grocery-list.mjs)

The draft appears at about 7:00 AM on the configured plan day, so you have until about 11:45 PM the night before delivery to review it, replace meals you don't want (optionally with a note like "no fish"; the new recipe shows in the plan within a minute or two, and you can replace it again), and add quick-add groceries. The list is then built automatically. (GitHub cron only speaks UTC, so two runs are scheduled to cover daylight saving time; the one outside the 11 PM Chicago hour skips itself, and a second run never rebuilds a finished list.) Approval is not required: an unapproved plan is still built, with a note.

To build it sooner, press **Confirm plan & build list now** on the Plan or Tonight tab. That approves the plan and starts the list immediately (it appears in a minute or two, ready for **Copy list for Muse**). **Rebuild list** does the same again if you change something afterwards. These buttons need the dispatch function below, and automation turned on.

What the list job does:

1. Finalizes any meal still marked for replacement (normally already done by the **Replace** button, which runs the replace-meal workflow). Replacements go through the same picker and Claude review.
2. Merges all recipe ingredients, then **Claude** trims the list against your staples and freezer so you only buy what's missing.
3. Adds quick adds, low staples and coupons-to-clip from `ads/current`, then saves the list to the board.

### Anthropic usage summary

| Where | Purpose | Max tokens |
|---|---|---|
| `fetch-flipp-ad.mjs` | Clean up coupons (optional, 1 call/week) | 2000 |
| `fetch-weekly-ad.mjs` | Structure scraped ad text (fallback only) | 4000 per batch |
| `plan-draft.mjs` | Write the one-week plan skeleton | 8000 |
| `recipePicker.mjs` | Accept or reject a recipe shortlist, add thaw notes | 1000 |
| `recipePicker.mjs` | Free-form recipe, only when no dataset match is accepted | 2000 |
| `grocery-list.mjs` | Trim ingredients against pantry and freezer | 1500 |

All calls go through [scripts/lib/claude.mjs](scripts/lib/claude.mjs). The model is `claude-sonnet-5-5` unless you set `ANTHROPIC_MODEL`.

## Repo layout

```
docs/                       The board, served as-is by GitHub Pages (no build step)
  index.html                  UI: markup, styles and script in one file
  config.js                   Supabase URL + publishable key
  supabase-adapter.js         Board <-> Supabase bridge, sign-in gate, realtime
sql/schema.sql              `documents` + `recipes` tables, Row Level Security, realtime
supabase/functions/dispatch-workflow/  Edge function the board uses to start allow-listed workflows
scripts/                    One entry script per job (all run by GitHub Actions unless noted)
  fetch-flipp-ad.mjs          Primary ad source: Flipp JSON -> ads/current
  fetch-weekly-ad.mjs         Fallback ad source: Playwright scraper + Claude
  plan-draft.mjs              Promotes a due draft; drafts the next one-week plan
  replace-meal.mjs            Swaps in new recipes for meals marked Replace
  grocery-list.mjs            Finalizes swaps and builds the grocery list
  capture-tomthumb-session.mjs  Local: saves a Tom Thumb browser session for the fallback
  load-recipes.mjs            Local: loads the recipe dataset into Supabase
  rebuild-grocery-list.mjs    Local recovery: rebuilds the list for the active plan
  dev-test-picker.mjs         Local smoke test for the recipe picker
scripts/lib/                Shared logic, one owner per concern:
  supabaseClient.mjs          Document reads/writes (same path model as the board)
  settings.mjs                Board Settings > env var > default; the automation switch
  planWindow.mjs              Dates, time zone, plan week and schedule windows
  recipePicker.mjs            Dataset query + Claude review, free-form fallback (pickRecipe)
  replaceMeals.mjs            Replacing meals marked swapOut
  groceryList.mjs             Pantry trim + order text (buildOrder)
  flipp.mjs                   Flipp client and ad normalizer
  claude.mjs                  Claude Messages API wrapper + JSON parsing
tools/import_recipes.py     Converts an nyt-cooking-parser sqlite export into staging JSON
test/                       Unit tests (Node's built-in runner, no network)
.github/workflows/          Scheduled jobs, replace-meal, and Tests (runs on every push)
```

### Design notes

- **One data model everywhere.** Every board document is a row in `documents` keyed by a `collection/id` path. The board (through the adapter) and the scripts (through `supabaseClient.mjs`) read and write the same paths, so there is no separate API layer.
- **The board is a single static page.** `docs/index.html` is edited directly. It keeps the original Supper Board's `window.claude.use("db")` interface, which `supabase-adapter.js` implements on Supabase. The adapter keeps one realtime channel and only refetches the document or collection that actually changed.
- **Scripts are thin.** Each entry script decides *whether* to run (automation switch, schedule window, plan status) and delegates the work to `scripts/lib`. Shared rules live in exactly one place: settings precedence and the automation gate (`settings.mjs`), dates and time zone (`planWindow.mjs`), recipe choice (`pickRecipe`), and the order list (`buildOrder`).
- **Settings live on the board.** Actions variables are only fallbacks, and secrets never live in Supabase documents.

## Setup

1. **Supabase:** create a project, run [sql/schema.sql](sql/schema.sql) in the SQL editor, and enable realtime for `documents` (Database → Replication).
2. **Keys:** put the project URL and **publishable key** (`sb_publishable_...`) in [docs/config.js](docs/config.js); it is safe to commit because RLS restricts it. Keep the **secret key** (`sb_secret_...`) out of the repo; it goes only in Actions secrets and your local `.env`.
3. **GitHub Pages:** Settings → Pages → Deploy from branch → `main` / `docs`. The site has no build step: edit `docs/` and commit.
4. **Actions secrets** (Settings → Secrets and variables → Actions): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and `TOM_THUMB_STORAGE_STATE` (fallback scraper only).
5. **Settings are on the board, not in GitHub.** Planning guidelines, cook-time limit, store, order method, pickup window, substitutions, ZIP, store address, the plan day, the delivery day and the first-plan start date are edited from the board's **Settings** tab (see below). The optional Actions variables `PLAN_GUIDELINES`, `PLAN_MAX_COOK_MINUTES`, `STORE_NAME`, `ORDER_METHOD`, `PICKUP_WINDOW`, `SUBSTITUTION_RULES`, `TOM_THUMB_ZIP`, `TOM_THUMB_STORE_ADDRESS`, `PLAN_DAY` and `DELIVERY_DAY` still work as defaults; anything saved on the board wins.
6. **Deploy the dispatch function** (enables the board's "Manually fetch weekly recipes from recipe box", "Replace this meal" and "Confirm plan & build list now" buttons; redeploy it after pulling updates). One time, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```
   supabase functions deploy dispatch-workflow --no-verify-jwt
   supabase secrets set GH_REPO=<your-user>/dinnerboard GH_DISPATCH_TOKEN=<token>
   ```

   The token is a fine-grained GitHub personal access token limited to this repository with **Actions: Read and write**. It lives only in Supabase secrets, never in the repo or the browser. The function checks the caller's Supabase sign-in and can only start `plan-draft.yml`, `replace-meal.yml` and `grocery-list.yml`. Without it, run those workflows from the Actions tab instead.
7. **Sign in** once on the deployed board via the magic-link prompt.
8. **Open the Settings tab** and follow **Get started** (below). No database seeding is needed.
9. **Test manually** with Actions → workflow_dispatch before waiting on the schedule. **Weekly ad fetch** has a **Dry run** checkbox that fetches from Flipp and writes nothing.

## First use and the Settings tab

The board's **Settings** tab replaces manual database seeding:

1. **Load your recipes:** the `recipes` table is a fixed, read-only dataset - Claude never writes to it. Load it once (or add more later) with `tools/import_recipes.py` + `scripts/load-recipes.mjs` (see **Recipe dataset** below). The Settings tab shows how many recipes are loaded, and **Manually fetch weekly recipes from recipe box** lets you draft this week's plan from that dataset on demand instead of waiting for the plan day.
2. **Pick a start date:** nothing is planned before it. Leave it blank to start tomorrow. It only affects the first plan.
3. **Turn on automation:** off by default, so nothing runs or costs anything until you switch it on.

Below the checklist you can edit planning guidelines, longest cook time, grocery store, order method (delivery or pickup), pickup window, substitution rules, Tom Thumb ZIP and store address. Saved values apply to the next weekly run. **Clear all planned meals** (here, and at the bottom of the Plan tab) removes every planned meal; past meals and ratings are kept and the next weekly run drafts a fresh plan.

On the Shopping tab, **Add many at once** under Staples takes a pasted comma- or line-separated list and skips items already listed.

Staples and freezer items are managed on the Shopping tab; there is no need to insert them by hand.
### Local commands

```
npm test                              # unit tests (Node's built-in runner)
FLIPP_DRY_RUN=1 npm run fetch-flipp-ad   # fetch and summarize, no Supabase write
node --env-file=.env scripts/replace-meal.mjs <draft-meal-id>   # preview a new pick for one draft meal
node --env-file=.env scripts/rebuild-grocery-list.mjs           # recover the list for the active plan
```

On PowerShell, set the variable first: `$env:FLIPP_DRY_RUN='1'`. Other switches: `FLIPP_ENRICH=0` skips per-item detail requests, and `FLIPP_CLAUDE=0` skips the coupon cleanup.

## Flipp ad source

Flipp is an **undocumented third-party interface**, not an official API, so it could change or block requests without notice. That is why the Playwright scraper stays as an automatic fallback.

- **Location:** Flipp returns flyers per ZIP, not per store. To change location, set `TOM_THUMB_ZIP`. There is no nearest-store search; if the ZIP has no Tom Thumb flyer, the job fails over to the scraper.
- **Provenance:** `ads/current` records `source`, `zip`, `flyerId`, `validFrom`, `validTo` and `fetchedAt`.
- **Known limits:** some offers have no price (BOGO and mix-and-match deals) and appear as coupon-style entries with their terms. Some item names bundle several products. Protein sorting is keyword-based, so a few items may land in the wrong group. A small share of missed deals is acceptable here.
- **Checked:** a spot check of about 35 products against the official PDF found matching prices and dates. Access from a GitHub-hosted runner has not been verified; run the manual workflow to confirm.

## Fallback scraper (Playwright)

[scripts/fetch-weekly-ad.mjs](scripts/fetch-weekly-ad.mjs) scrapes tomthumb.com/weeklyad and writes the same `ads/current` shape. tomthumb.com's store picker blocks automated clicks, so you select the store **once by hand** and the saved session (cookies and localStorage) is reused headlessly.

**Capturing or refreshing the session:**

```
npm run capture-tomthumb-session
```

A real browser opens. In it: dismiss the cookie banner, open the top-left menu, click the store address, enter your ZIP, choose **In Store** if needed, click **Select** on your store, then press Enter in the terminal. The session is saved to `scripts/_tomthumb-storageState.json` (gitignored; never commit it). Copy its contents into the `TOM_THUMB_STORAGE_STATE` secret. Locally the scraper reads that file automatically.

**When to re-run it:** sessions expire. If the scraper writes `ok: false` with *"Saved session didn't land on the expected store"* or *"No Tom Thumb session found"*, capture again and update the secret. A failed ad is never a hard blocker: the plan and grocery list still run, just without sale bias.

## Recipe dataset

Recipes live in the Supabase `recipes` table, ported from the sqlite db produced by the separate nyt-cooking-parser project. Each row has `title`, `url`, `description`, `tags`, `rating`, `rating_count`, a derived `course` (`entree` / `side` / `other`) and `protein` (`chicken` / `beef` / `pork` / `turkey` / `lamb` / `fish` / `vegetarian` / `null`), plus the board's recipe shape (`serves`, `time_minutes`, `oven`, `ingredients`, `steps`, `tip`).

> If your `recipes` table predates `course`/`protein`, add them:
> ```sql
> alter table recipes add column if not exists course text not null default 'other';
> alter table recipes add column if not exists protein text;
> ```

To load or refresh the dataset (re-running is safe; it upserts by `id`):

```
python tools/import_recipes.py <path-to-recipes.db> .recipes-staging.json
node --env-file=.env scripts/load-recipes.mjs .recipes-staging.json
```

The staging JSON is gitignored.

## How recipes get picked

For every cook night, [scripts/lib/recipePicker.mjs](scripts/lib/recipePicker.mjs) runs:

1. Claude drafts the plan skeleton with a target protein per cook night.
2. `pickCandidates` queries Supabase for up to 10 entrees matching the protein, `time_minutes <= PLAN_MAX_COOK_MINUTES` and `rating >= 4`, excluding recipes used recently or earlier in the draft. The order is deterministic (rating desc, id asc). If nothing matches, it relaxes the rating floor, then the time cap, then the protein.
3. Claude reviews the shortlist against guidelines, history, freezer and staples. It either accepts one (writing `details` and `thaw` instructions) or rejects the batch with a reason. On rejection those ids are excluded and it retries, up to 3 rounds.
4. If nothing is accepted, `generateFreeformRecipe` has Claude write a recipe from scratch, so a meal is never left without one.

`sourceRecipeId` is saved on each meal so future runs can exclude recipes already used.

## Credit

Design, data model, and the original planning workflow are from [Supper Board](https://github.com/weezerhunter/Supper-Board) by weezerhunter, MIT licensed. This repo re-implements its automation on different infrastructure; the board's look and data shape are unchanged.
