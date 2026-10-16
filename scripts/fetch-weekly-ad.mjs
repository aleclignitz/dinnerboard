// Wednesday job (runs before plan-draft/grocery-list): scrapes this week's
// Tom Thumb weekly ad with a headless browser and writes a structured
// summary to ads/current. The ad is served through a cross-origin Flipp
// iframe widget - a plain fetch() can't see it, but Playwright's
// frameLocator() can reach into it directly (verified: page.frames()/
// $$eval do NOT see this content, frameLocator() does).
//
// Store selection used to be a live UI flow (zip -> nearby stores -> pick
// one), but Tom Thumb's site appears to block or no-op synthetic clicks on
// that flow in automated browsers (confirmed: works with a real mouse click
// in a headful window, fails consistently - headless or headful - when
// driven by Playwright's locator.click()). Instead, a logged-in/store-
// selected session is captured once by hand (see
// `scripts/capture-tomthumb-session.mjs`) and reused headlessly via
// Playwright's storageState, skipping the UI entirely. If the store ever
// changes or the session expires, re-run that capture script and update the
// TOM_THUMB_STORAGE_STATE secret.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { getSupabase, getDoc, setDoc } from "./lib/supabaseClient.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AD_URL = "https://www.tomthumb.com/weeklyad";
const STORE_ADDRESS = process.env.TOM_THUMB_STORE_ADDRESS || "6333 E Mockingbird Ln";
const MIN_DEALS = 20;
const FETCH_ATTEMPTS = 4;

// TOM_THUMB_STORAGE_STATE (CI secret, raw JSON) takes precedence; falls
// back to a local file for development (see capture-tomthumb-session.mjs).
function loadStorageState() {
  if (process.env.TOM_THUMB_STORAGE_STATE) {
    return JSON.parse(process.env.TOM_THUMB_STORAGE_STATE);
  }
  const localPath = path.join(SCRIPT_DIR, "_tomthumb-storageState.json");
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf8"));
  }
  return null;
}

// Nav controls ("Move to the left", "Move Up", ...) share the same <button>
// markup as real deal tiles - only keep ones that read like an actual deal.
function isDealLabel(label) {
  return /member price|coupon|select for details/i.test(label) && !/^move (up|down|to the)/i.test(label);
}

async function getDealLabels(page) {
  const frame = page.frameLocator("main iframe");
  const buttons = frame.locator("button");
  const count = await buttons.count().catch(() => 0);
  const labels = [];
  for (let i = 0; i < count; i++) {
    const label = await buttons.nth(i).getAttribute("aria-label").catch(() => null);
    if (label && isDealLabel(label)) labels.push(label.trim());
  }
  return labels;
}

// The Flipp widget is flaky about rendering on first load (seen skeleton/
// empty states repeatedly in manual testing) - reload a few times with
// increasing waits before giving up.
async function fetchDealLabelsWithRetry(page) {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    await page.goto(AD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000 + attempt * 2000);
    const labels = await getDealLabels(page);
    if (labels.length >= MIN_DEALS) return labels;
    console.log(`Attempt ${attempt + 1}/${FETCH_ATTEMPTS}: found ${labels.length} deals, retrying...`);
  }
  return [];
}

// Structuring the whole week's labels in one Claude call risks the reply
// getting cut off by max_tokens on a big ad (seen in production - the reply
// was truncated mid-JSON). Batch instead so no single call's output can
// grow unbounded, and merge the per-batch results back together.
const STRUCTURE_BATCH_SIZE = 60;

function dedupe(items) {
  return [...new Set(items)];
}

function mergeProteinDeals(batches) {
  const byProtein = new Map();
  for (const deals of batches) {
    for (const { protein, items } of deals) {
      if (!protein) continue;
      byProtein.set(protein, (byProtein.get(protein) || []).concat(items || []));
    }
  }
  return [...byProtein.entries()].map(([protein, items]) => ({ protein, items: dedupe(items) }));
}

async function structureDealsBatch(labels) {
  const system = "You convert raw grocery weekly-ad deal text into structured JSON only, no prose.";
  const prompt = `Raw deal labels scraped from this week's Tom Thumb weekly ad (each is one ad tile's accessible name - may list several product options separated by "or", a price, and whether a digital coupon needs clipping):
${JSON.stringify(labels)}

Return JSON with exactly this shape:
{
  "proteinDeals": [{"protein": "chicken|beef|pork|turkey|lamb|fish|vegetarian", "items": ["short description of each sale cut/item, with price"]}],
  "deals": ["one cleaned-up line per deal: item(s) + price"],
  "coupons": ["cart-level or whole-order coupons that need clipping, e.g. $10 off $75 purchase"]
}
Only put real protein sale items in "proteinDeals" (skip household/beauty/floral/etc there, but still include them in "deals"). Dedupe near-identical lines.`;
  const raw = await askClaude({ system, prompt, maxTokens: 4000 });
  return parseClaudeJson(raw);
}

async function structureDeals(labels) {
  const batches = [];
  for (let i = 0; i < labels.length; i += STRUCTURE_BATCH_SIZE) {
    batches.push(labels.slice(i, i + STRUCTURE_BATCH_SIZE));
  }
  const results = [];
  for (const batch of batches) {
    try {
      results.push(await structureDealsBatch(batch));
    } catch (err) {
      console.log(`Batch of ${batch.length} deals failed to structure, skipping: ${err.message}`);
    }
  }
  return {
    proteinDeals: mergeProteinDeals(results.map((r) => r.proteinDeals || [])),
    deals: dedupe(results.flatMap((r) => r.deals || [])),
    coupons: dedupe(results.flatMap((r) => r.coupons || []))
  };
}

async function scrapeAd() {
  const storageState = loadStorageState();
  if (!storageState) {
    return {
      ok: false,
      error: "No Tom Thumb session found. Run `node scripts/capture-tomthumb-session.mjs` once and set the TOM_THUMB_STORAGE_STATE secret."
    };
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto(AD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!bodyText.includes(STORE_ADDRESS)) {
      return {
        ok: false,
        error: `Saved session didn't land on the expected store (looked for "${STORE_ADDRESS}"). It may have expired - re-run capture-tomthumb-session.mjs and update the TOM_THUMB_STORAGE_STATE secret.`
      };
    }

    const labels = await fetchDealLabelsWithRetry(page);
    if (!labels.length) {
      return { ok: false, error: "No deals found after retries - ad widget may not have rendered, or the site layout changed." };
    }
    const structured = await structureDeals(labels);
    if (!structured.deals.length && !structured.proteinDeals.length) {
      return { ok: false, error: `Found ${labels.length} raw deal labels but Claude failed to structure all batches - see logs above.` };
    }
    return {
      ok: true,
      store: STORE_ADDRESS,
      proteinDeals: structured.proteinDeals || [],
      deals: structured.deals || [],
      coupons: structured.coupons || []
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const supabase = getSupabase();

  // Off by default: the board's "Turn on automation" button must set
  // enabled:true before any processing or Anthropic calls happen here.
  const automation = await getDoc(supabase, "settings/automation");
  if (!automation || automation.enabled !== true) {
    console.log("Automation is off (default). Skipping weekly ad fetch.");
    return;
  }

  let result;
  try {
    result = await scrapeAd();
  } catch (err) {
    console.error("Weekly ad fetch failed:", err);
    result = { ok: false, error: String((err && err.message) || err) };
  }

  await setDoc(supabase, "ads/current", { ...result, fetchedAt: new Date().toISOString() });

  if (!result.ok) {
    console.error(`Wrote a failed ads/current doc (${result.error}); plan-draft/grocery-list will proceed without sale bias.`);
    process.exitCode = 1;
  } else {
    console.log(`Wrote ${result.deals.length} deals, ${result.coupons.length} coupons to ads/current.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
