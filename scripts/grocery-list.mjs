// Wednesday job (runs after plan-draft, same morning as fetch-weekly-ad):
// finalizes any meals marked "Replace", builds one grocery list, and saves
// it on the board behind the Copy list button. Ported from
// automation/2-grocery-list-task.md, minus the Google Drive save (STEP 4) -
// Muse (or any agent) picks the list up via the board's Copy list button
// for now instead of a Drive doc.
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
import { selectRecipeForMeal, generateFreeformRecipe } from "./lib/recipePicker.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";
import { loadSettings } from "./lib/settings.mjs";
import { scheduledWindowOpen } from "./lib/planWindow.mjs";

// Filled from board Settings (falling back to env vars) once main() starts.
let STORE, SUBSTITUTION_RULES, MAX_COOK_MINUTES, ORDER_METHOD, PICKUP_WINDOW, SETTINGS_GUIDELINES;



// Word matching can't tell "2 lb ground beef" needs buying despite a freezer
// entry reading "Ground beef, 1 lb", so Claude reconciles quantities/spices
// instead. Falls back to the raw, unfiltered list if the call fails.
async function trimIngredientsAgainstPantry({ ingredients, staples, freezer }) {
  if (!ingredients.length) return ingredients;
  const system = "You trim a merged recipe ingredient list down to what still needs to be bought, and output ONLY valid JSON, no prose.";
  const prompt = `Raw recipe ingredients for this week's meals (combined across recipes, may include duplicates/overlaps - merge those into one line):
${JSON.stringify(ingredients)}

Pantry staples, with status ("have" = stocked, "low"/"unknown" = buy it): ${JSON.stringify(staples)}

Freezer inventory on hand, with quantities: ${JSON.stringify(freezer)}

Drop any ingredient fully covered by a "have" staple (e.g. skip salt, pepper, common spices, cooking oil, soy sauce) or by freezer stock that covers the amount needed this week. If multiple recipes need more of something than the freezer has (e.g. two recipes need 1 lb ground beef each but the freezer only has 1 lb), keep a line for the remaining amount instead of dropping it entirely. Merge duplicate/overlapping ingredients into one line with a combined quantity. Do not invent items that weren't in the raw list, and do not drop anything you're unsure about - buying a small duplicate is fine, missing an ingredient is not.

Return JSON with exactly this shape:
{"items": ["item 1", "item 2"]}`;
  try {
    const raw = await askClaude({ system, prompt, maxTokens: 1500 });
    const parsed = parseClaudeJson(raw);
    return Array.isArray(parsed.items) && parsed.items.length ? parsed.items : ingredients;
  } catch (err) {
    console.error("Pantry trim failed, falling back to the unfiltered ingredient list:", err);
    return ingredients;
  }
}

async function main() {
  const scheduled = process.env.GITHUB_EVENT_NAME === "schedule";
  // Scheduled runs fire twice (CDT and CST); manual runs always go.
  if (scheduled && !scheduledWindowOpen()) {
    console.log("Scheduled run outside the 11 PM Chicago window (DST twin). Skipping.");
    return;
  }
  const supabase = getSupabase();

  // Off by default: the board's "Turn on automation" button must set
  // enabled:true before any processing or Anthropic calls happen here.
  const automation = await getDoc(supabase, "settings/automation");
  if (!automation || automation.enabled !== true) {
    console.log("Automation is off (default). Turn it on from the board to enable the weekly grocery list. Skipping.");
    return;
  }

  const settings = await loadSettings(supabase);
  STORE = settings.storeName;
  SUBSTITUTION_RULES = settings.substitutionRules;
  MAX_COOK_MINUTES = settings.maxCookMinutes;
  ORDER_METHOD = settings.orderMethod; // "pickup" or "delivery"
  PICKUP_WINDOW = settings.pickupWindow;
  SETTINGS_GUIDELINES = settings.planGuidelines;

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

  // STEP 2: replace any meal marked swapOut
  const draftMeals = await getCollection(supabase, "draft");
  const toSwap = draftMeals.filter((m) => m.swapOut);
  const history = await getCollection(supabase, "history");
  const freezer = await getCollection(supabase, "freezer");
  const usedRecipeIds = [...draftMeals, ...history].map((m) => m.sourceRecipeId).filter(Boolean);
  for (const m of toSwap) {
    const notes = (await getCollection(supabase, "notes")).filter((n) => n.meal === m.id);
    const ideas = await getCollection(supabase, "ideas");
    const context = { history: [...history.slice(-30), ...notes], freezer, ideas, saleDeals: ad && ad.ok ? ad.deals : [] };

    let replacement;
    if (m.kind === "cook") {
      const selection = await selectRecipeForMeal(supabase, {
        date: m.date,
        kind: m.kind,
        maxTime: MAX_COOK_MINUTES,
        guidelines: SETTINGS_GUIDELINES || current.guidelines || "",
        context,
        excludeIds: usedRecipeIds
      });
      if (selection) {
        replacement = selection;
        usedRecipeIds.push(selection.sourceRecipeId);
      }
    }
    if (!replacement) {
      replacement = await generateFreeformRecipe({ date: m.date, kind: m.kind, guidelines: SETTINGS_GUIDELINES || current.guidelines || "", context });
    }
    await setDoc(supabase, `draft/${m.id}`, { ...m, ...replacement, swapOut: false });
  }

  // STEP 3: build the order list
  const finalMeals = await getCollection(supabase, "draft");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const lowStaples = staples.filter((s) => s.status === "low");
  const rawIngredients = finalMeals.flatMap((m) => (m.recipe && m.recipe.ingredients) || []);
  const allIngredients = await trimIngredientsAgainstPantry({ ingredients: rawIngredients, staples, freezer });
  const pickupLabel = draftPlan.pickup || "tomorrow";

  const lines = [];
  const timing = ORDER_METHOD === "pickup" ? `, with an afternoon pickup (${PICKUP_WINDOW} if available)` : ", for delivery";
  lines.push(`Please build a ${STORE} order for ${pickupLabel}${timing}, with these items:`);
  lines.push("", "Recipe ingredients:");
  allIngredients.forEach((i) => lines.push(`- ${i}`));
  if (grocery.length) {
    lines.push("", "Quick adds:");
    grocery.forEach((g) => lines.push(`- ${g.text}`));
  }
  if (lowStaples.length) {
    lines.push("", "Staples running low:");
    lowStaples.forEach((s) => lines.push(`- ${s.name}`));
  }
  if (ad && ad.ok && ad.coupons.length) {
    lines.push("", "Coupons to clip (Tom Thumb weekly ad):");
    ad.coupons.forEach((c) => lines.push(`- ${c}`));
  }
  if (!ad || ad.ok === false) {
    lines.push("", "Note: this week's Tom Thumb ad could not be retrieved - no sale-based substitutions were applied.");
  }
  lines.push("", `${SUBSTITUTION_RULES} Leave the order for me to review before it's placed.`);
  const orderText = lines.join("\n");

  // STEP 5: write back (no Google Drive save in this basic version)
  await setDoc(supabase, "plan/draft", {
    ...draftPlan,
    orderText,
    included: { grocery: grocery.map((g) => g.id), staples: lowStaples.map((s) => s.id) }
  });
  const itemCount = allIngredients.length + grocery.length + lowStaples.length;
  await setDoc(supabase, "plan/current", {
    ...current,
    status: "list_ready",
    pickup: pickupLabel,
    statusNote: `${itemCount} items.${current.status === "drafted" ? " Not approved yet." : ""}`
  });

  console.log(`Grocery list ready: ${itemCount} items for ${pickupLabel}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
