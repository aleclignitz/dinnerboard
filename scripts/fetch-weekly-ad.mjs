// Wednesday job (runs before plan-draft/grocery-list): scrapes this week's
// Tom Thumb weekly ad with a headless browser and writes a structured
// summary to ads/current. The ad is served through a cross-origin Flipp
// iframe widget - a plain fetch() can't see it, but Playwright's
// frameLocator() can reach into it directly (verified: page.frames()/
// $$eval do NOT see this content, frameLocator() does).
//
// Store selection (zip -> nearby stores -> pick one) is a multi-step UI
// flow reverse-engineered by hand; selectors are text/role based to survive
// minor markup changes, but Tom Thumb could still change this layout.
// Always test with `workflow_dispatch` after any failure before trusting
// the cron run - see README.
import { chromium } from "playwright";
import { getSupabase, getDoc, setDoc } from "./lib/supabaseClient.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";

const AD_URL = "https://www.tomthumb.com/weeklyad";
const ZIP = process.env.TOM_THUMB_ZIP || "75214";
const STORE_ADDRESS = process.env.TOM_THUMB_STORE_ADDRESS || "6333 E Mockingbird Ln";
const MIN_DEALS = 20;
const FETCH_ATTEMPTS = 4;

// Nav drawer -> "Instore at ..." entry -> zip textbox -> store list -> Select.
async function selectStore(page, { zip, storeAddress }) {
  await page.goto("https://www.tomthumb.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  await page.getByRole("button", { name: /navigation menu/i }).click();
  await page.waitForTimeout(1000);

  const storeEntry = page.getByRole("button", { name: /instore at|choose.*store|select.*store/i }).first();
  await storeEntry.waitFor({ state: "visible", timeout: 10000 });
  await storeEntry.click();
  await page.waitForTimeout(1000);

  const zipBox = page.getByRole("textbox", { name: /zip/i }).or(page.getByPlaceholder(/zip/i)).first();
  await zipBox.waitFor({ state: "visible", timeout: 10000 });
  await zipBox.fill(zip);
  await page.getByRole("button", { name: /search.*zip/i }).first().click();
  await page.waitForTimeout(2000);

  // Results are tabbed by fulfillment method - make sure we're looking at
  // in-store pickup/ad locations, not delivery-only ones.
  await page.getByRole("tab", { name: /in ?store/i }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);

  const row = page.getByText(storeAddress, { exact: false }).first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  const selectBtn = row
    .locator("xpath=ancestor::*[self::li or self::div][1]")
    .getByRole("button", { name: /select/i })
    .first();
  await selectBtn.click();
  await page.waitForTimeout(1500);
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

async function structureDeals(labels) {
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

async function scrapeAd() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await selectStore(page, { zip: ZIP, storeAddress: STORE_ADDRESS });
    const labels = await fetchDealLabelsWithRetry(page);
    if (!labels.length) {
      return { ok: false, error: "No deals found after retries - ad widget may not have rendered, or the site layout changed." };
    }
    const structured = await structureDeals(labels);
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
