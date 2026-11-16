// Primary weekly ad source: fetches the Tom Thumb ad from Flipp (no browser)
// and writes ads/current. Set FLIPP_DRY_RUN=1 to print a summary without
// touching Supabase (uses TOM_THUMB_ZIP or the default ZIP).
import { getSupabase, getDoc, setDoc } from "./lib/supabaseClient.mjs";
import { fetchTomThumbAd, shouldReplace, isExpired, refineCoupons } from "./lib/flipp.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";
import { loadSettings, resolveSettings, automationEnabled } from "./lib/settings.mjs";

const DRY = process.env.FLIPP_DRY_RUN === "1";
const ENRICH = process.env.FLIPP_ENRICH !== "0";
// Claude coupon cleanup runs only when a key is present; FLIPP_CLAUDE=0 disables it.
const USE_CLAUDE = process.env.FLIPP_CLAUDE !== "0" && !!process.env.ANTHROPIC_API_KEY;

async function getAd(zip) {
  const doc = await fetchTomThumbAd({ zip, enrich: ENRICH });
  return USE_CLAUDE ? refineCoupons(doc, { ask: askClaude, parse: parseClaudeJson }) : doc;
}

async function main() {
  if (DRY) {
    const doc = await getAd(resolveSettings({}).zip);
    console.log(`Dry run: flyer ${doc.flyerId}, ${doc.deals.length} deals, ${doc.coupons.length} coupons, proteins: ${doc.proteinDeals.map((p) => `${p.protein}=${p.items.length}`).join(", ")}`);
    return;
  }

  const supabase = getSupabase();
  if (!(await automationEnabled(supabase))) {
    console.log("Automation is off (default). Skipping weekly ad fetch.");
    return;
  }
  const { zip } = await loadSettings(supabase);
  const existing = await getDoc(supabase, "ads/current");

  let doc;
  try {
    doc = await getAd(zip);
  } catch (err) {
    console.error("Flipp fetch failed:", err);
    // Keep a still-valid ad; never leave expired deals looking healthy.
    if (existing?.ok === true && !isExpired(existing)) {
      console.error("Keeping existing unexpired ads/current.");
    } else {
      await setDoc(supabase, "ads/current", { ok: false, source: "flipp", error: String(err.message || err), fetchedAt: new Date().toISOString() });
    }
    process.exitCode = 1;
    return;
  }

  if (!shouldReplace(existing, doc)) {
    console.log(`Existing ads/current (flyer ${existing.flyerId}) is newer than ${doc.flyerId}; not replacing.`);
    return;
  }
  await setDoc(supabase, "ads/current", doc);
  console.log(`Wrote ${doc.deals.length} deals, ${doc.coupons.length} coupons (flyer ${doc.flyerId}) to ads/current.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
