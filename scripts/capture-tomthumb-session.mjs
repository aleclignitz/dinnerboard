// One-time (or occasional) manual helper: opens a real browser window so a
// human can click through Tom Thumb's store-picker UI (that flow appears to
// block/no-op synthetic Playwright clicks - see fetch-weekly-ad.mjs header),
// then saves the resulting cookies/localStorage as a storageState file.
//
// Usage: node scripts/capture-tomthumb-session.mjs
// Then either:
//   - paste the file contents into the TOM_THUMB_STORAGE_STATE GitHub secret, or
//   - leave the file at scripts/_tomthumb-storageState.json for local dev runs
//     (fetch-weekly-ad.mjs falls back to it automatically; it's gitignored).
//
// Re-run this whenever fetch-weekly-ad.mjs starts failing with a "session
// didn't land on the expected store" / expired-session error.
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(SCRIPT_DIR, "_tomthumb-storageState.json");
const STORE_ADDRESS = process.env.TOM_THUMB_STORE_ADDRESS || "6333 E Mockingbird Ln";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

try {
  await page.goto("https://www.tomthumb.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  console.log("A browser window is open. Please:");
  console.log('1. Dismiss the cookie banner if present ("Continue with all" or similar).');
  console.log("2. Click the hamburger/navigation menu icon (top-left).");
  console.log("3. Click the store address button in the drawer that opens.");
  console.log(`4. Enter zip code ${process.env.TOM_THUMB_ZIP || "75214"} and search.`);
  console.log(`5. Click "In Store" if needed, then click Select on "${STORE_ADDRESS}".`);
  await rl.question("Press Enter here once the store is selected > ");

  await page.goto("https://www.tomthumb.com/weeklyad", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const bodyText = await page.locator("body").innerText();
  if (!bodyText.includes(STORE_ADDRESS)) {
    console.error(`Warning: weekly ad page doesn't mention "${STORE_ADDRESS}". Double check the right store was selected.`);
  } else {
    console.log(`Confirmed: weekly ad is showing ${STORE_ADDRESS}.`);
  }

  await context.storageState({ path: OUTPUT_PATH });
  console.log(`Saved session to ${OUTPUT_PATH}`);
  console.log("Copy its contents into the TOM_THUMB_STORAGE_STATE GitHub secret for CI use.");
} finally {
  rl.close();
  await browser.close();
}
