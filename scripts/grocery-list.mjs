// Runs nightly, but only builds the list the night before the board's
// configured delivery day (or whenever started manually, e.g. by the board's
// "Confirm plan & build list now" button). Finalizes any meals still marked
// "Replace", builds one grocery list, and saves it on the board behind the
// Copy list button.
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
import { replaceMarkedMeals } from "./lib/replaceMeals.mjs";
import { buildOrder } from "./lib/groceryList.mjs";
import { loadSettings, automationEnabled } from "./lib/settings.mjs";
import { addDays, scheduledWindowOpen, todayInZone } from "./lib/planWindow.mjs";

async function main() {
  const scheduled = process.env.GITHUB_EVENT_NAME === "schedule";
  // Scheduled runs fire twice (CDT and CST); manual runs always go.
  if (scheduled && !scheduledWindowOpen()) {
    console.log("Scheduled run outside the 11 PM Chicago window (DST twin). Skipping.");
    return;
  }
  const supabase = getSupabase();
  if (!(await automationEnabled(supabase))) {
    console.log("Automation is off (default). Turn it on from the board to enable the weekly grocery list. Skipping.");
    return;
  }

  const settings = await loadSettings(supabase);
  const current = (await getDoc(supabase, "plan/current")) || {};
  const draftPlan = await getDoc(supabase, "plan/draft");
  const ad = await getDoc(supabase, "ads/current");

  // STEP 1: is a list due?
  // Scheduled runs only build once (list_ready means done); a manual run may rebuild.
  const buildable = scheduled ? ["drafted", "approved"] : ["drafted", "approved", "list_ready"];
  if (!draftPlan || !buildable.includes(current.status)) {
    console.log("No list due this week.");
    return;
  }
  if (scheduled && draftPlan.pickup) {
    const today = todayInZone();
    if (addDays(draftPlan.pickup, -1) !== today) {
      console.log(`Scheduled run, but tonight (${today}) isn't the night before delivery (${draftPlan.pickup}). Skipping.`);
      return;
    }
  }

  // STEP 2: finalize any meal still marked swapOut (normally already replaced from the board)
  await replaceMarkedMeals(supabase, { current, ad, maxCookMinutes: settings.maxCookMinutes, guidelines: settings.planGuidelines });

  // STEP 3: build the order list and save it on the board
  const pickup = draftPlan.pickup || "tomorrow";
  const { orderText, included, itemCount } = await buildOrder({
    meals: await getCollection(supabase, "draft"),
    grocery: await getCollection(supabase, "grocery"),
    staples: await getCollection(supabase, "staples"),
    freezer: await getCollection(supabase, "freezer"),
    settings,
    ad,
    pickup
  });
  await setDoc(supabase, "plan/draft", { ...draftPlan, orderText, included });
  await setDoc(supabase, "plan/current", {
    ...current,
    status: "list_ready",
    pickup,
    statusNote: `${itemCount} items.${current.status === "drafted" ? " Not approved yet." : ""}`
  });

  console.log(`Grocery list ready: ${itemCount} items for ${pickup}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
