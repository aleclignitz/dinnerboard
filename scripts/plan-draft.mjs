// Runs daily: promotes a due draft into the live plan, then (only on the
// board's configured plan day) drafts the next week. Cook-night recipes come
// from the Supabase recipes dataset via a deterministic picker + Claude
// review (lib/recipePicker.mjs), falling back to free-form generation only
// if nothing in the dataset fits.
import { getSupabase, getDoc, getCollection, setDoc, deleteDoc } from "./lib/supabaseClient.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";
import { pickRecipe } from "./lib/recipePicker.mjs";
import { loadSettings, automationEnabled } from "./lib/settings.mjs";
import { nextPlanWindow, meetsWindow, describeRhythm, dayNameToIndex, todayInZone, weekdayOf, PLAN_DAYS } from "./lib/planWindow.mjs";

// Lets the board's "Manually fetch weekly recipes from recipe box" button show progress/results.
async function status(supabase, patch) {
  try {
    await setDoc(supabase, "settings/planDraft", { ...patch, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Couldn't write plan-draft status:", err.message);
  }
}

// Moves the current meals to history and the draft into meals once the draft
// has started. Kept until the order is actually placed, no matter how many
// days have passed, so a pending order is never silently discarded.
async function promoteDueDraft(supabase, today) {
  const draftMeals = await getCollection(supabase, "draft");
  if (!draftMeals.length) return false;
  const earliest = draftMeals.map((m) => m.date).sort()[0];
  const planStatus = ((await getDoc(supabase, "plan/current")) || {}).status;
  if (earliest > today || ["list_ready", "cart_built"].includes(planStatus)) return false;

  for (const { id, ...rest } of await getCollection(supabase, "meals")) {
    await setDoc(supabase, `history/${id}`, rest);
    await deleteDoc(supabase, `meals/${id}`);
  }
  for (const { id, swapOut, ...rest } of draftMeals) {
    await setDoc(supabase, `meals/${id}`, rest);
    await deleteDoc(supabase, `draft/${id}`);
  }
  await deleteDoc(supabase, "plan/draft");
  const current = (await getDoc(supabase, "plan/current")) || {};
  const dates = (await getCollection(supabase, "meals")).map((m) => m.date).sort();
  await setDoc(supabase, "plan/current", {
    ...current,
    start: dates[0],
    end: dates[dates.length - 1],
    status: "active",
    pickup: "",
    statusNote: ""
  });
  return true;
}

async function main() {
  const supabase = getSupabase();
  await status(supabase, { status: "running", message: "" });

  if (!(await automationEnabled(supabase))) {
    console.log("Automation is off (default). Turn it on from the board to enable weekly plan drafts. Skipping.");
    await status(supabase, { status: "skipped", message: "Automation is off. Turn it on in Settings, then try again." });
    return;
  }

  const settings = await loadSettings(supabase);
  const today = todayInZone();
  const notes = [];

  // STEP 1: housekeeping - promote a due draft into the live plan
  if (await promoteDueDraft(supabase, today)) notes.push("Promoted the drafted plan to active.");

  // STEP 2: is a draft due?
  if ((await getCollection(supabase, "draft")).length) {
    console.log("Draft already pending, nothing to do.", notes.join(" "));
    await status(supabase, { status: "skipped", message: "A draft is already waiting for review on the Plan tab." });
    return;
  }
  const meals = await getCollection(supabase, "meals");
  // With no plan yet, the board Settings start date (if still in the future, else the
  // next configured delivery day) is the first day to plan.
  const { start: newStart, end: newEnd, pickup, due } = nextPlanWindow({
    today,
    mealDates: meals.map((m) => m.date),
    startDate: settings.startDate,
    deliveryDow: dayNameToIndex(settings.deliveryDay)
  });
  if (!due) {
    console.log(`Next draft not due until the day before ${newStart}.`, notes.join(" "));
    await status(supabase, { status: "skipped", message: `Next plan isn't due until the day before ${newStart}.` });
    return;
  }
  // A new draft is only started on the board's configured plan day; promotion above still runs daily.
  if (weekdayOf(today) !== dayNameToIndex(settings.planDay)) {
    const message = `Next plan is due, but today isn't the configured plan day (${settings.planDay}).`;
    console.log(message, notes.join(" "));
    await status(supabase, { status: "skipped", message });
    return;
  }

  // STEP 3: gather context
  const history = await getCollection(supabase, "history");
  const ideas = await getCollection(supabase, "ideas");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const freezer = await getCollection(supabase, "freezer");
  const current = (await getDoc(supabase, "plan/current")) || {};
  const guidelines = settings.planGuidelines || current.guidelines || "";
  const ad = await getDoc(supabase, "ads/current");
  const saleSummary = ad && ad.ok && ad.proteinDeals && ad.proteinDeals.length
    ? ad.proteinDeals.map((p) => `${p.protein}: ${p.items.join("; ")}`).join(" | ")
    : "(no sale data this week)";

  // STEP 4: ask Claude to draft the plan skeleton as JSON
  const system = "You write a one-week household dinner plan as strict JSON only, no prose, no markdown fences.";
  const prompt = `Household guidelines: ${guidelines}
Plan range: ${newStart} to ${newEnd} (exactly ${PLAN_DAYS} dinners, one per date). Groceries are delivered ${pickup}; the first dinner is the day after, once everything is put away.
Default rhythm: ${describeRhythm(newStart)}. Fresh produce and the sale items bought this week should be used within the week.
Recent history with ratings (bring back 4-5 star meals at most twice, never repeat 1-2 star meals): ${JSON.stringify(history.slice(-30))}
Requests to address: ${JSON.stringify(ideas)}
Freezer on hand (use first): ${JSON.stringify(freezer)}
Staples (skip "have" items from the grocery list): ${JSON.stringify(staples)}
Quick-add groceries already requested: ${JSON.stringify(grocery)}
This week's grocery sale highlights (lean toward these proteins for cook nights when they fit the guidelines and recent history, but don't force a mismatch): ${saleSummary}

For every "cook" night, set "protein" to one of chicken, beef, pork, turkey, lamb, fish, vegetarian - rotate these across the week per the guidelines (recipes themselves are picked separately from a fixed dataset, so do not write ingredients/steps for cook nights). For any "flex" night with a specific dish in mind, write a full "recipe" as shown below instead. "leftovers" nights need neither. Any meal using a frozen protein needs a "thaw" field describing what to move from freezer to fridge the night before.

Return JSON with exactly this shape:
{
  "meals": [{"date":"YYYY-MM-DD","kind":"cook|leftovers|flex","details":"","from":"","thaw":"","protein":"","recipe":null}],
  "summary": "1-2 sentences: what's new and what's returning",
  "prep": "Freeze on arrival: ... (only what will not be used within about 3 days)",
  "groceries": [{"section":"Proteins","items":[""]}]
}`;

  const plan = parseClaudeJson(await askClaude({ system, prompt, maxTokens: 8000 }));
  plan.meals = meetsWindow(plan.meals, newStart, newEnd);
  if (!plan.meals.length) throw new Error(`Claude returned no meals dated ${newStart} to ${newEnd}`);

  // STEP 5: fill in a real recipe for every cook night
  const context = { history: history.slice(-30), freezer, staples };
  const usedRecipeIds = history.map((m) => m.sourceRecipeId).filter(Boolean);
  for (const meal of plan.meals) {
    if (meal.kind === "cook") {
      const r = await pickRecipe(supabase, {
        date: meal.date,
        kind: meal.kind,
        protein: meal.protein,
        maxTime: settings.maxCookMinutes,
        guidelines,
        context,
        excludeIds: usedRecipeIds
      });
      Object.assign(meal, { title: r.title, details: r.details || meal.details || "", thaw: r.thaw || meal.thaw || "", recipe: r.recipe });
      if (r.sourceRecipeId) {
        meal.sourceRecipeId = r.sourceRecipeId;
        usedRecipeIds.push(r.sourceRecipeId);
      }
    }
    delete meal.protein;
  }

  // STEP 6: save the draft
  const dayStamp = newStart.replace(/-/g, "");
  for (let i = 0; i < plan.meals.length; i++) {
    const id = `p${dayStamp}-${String(i + 1).padStart(2, "0")}`;
    await setDoc(supabase, `draft/${id}`, { ...plan.meals[i], thawDone: false, rating: 0, swapOut: false });
  }
  await setDoc(supabase, "plan/draft", {
    start: newStart,
    end: newEnd,
    pickup,
    summary: plan.summary,
    prep: plan.prep,
    groceries: plan.groceries
  });
  await setDoc(supabase, "plan/current", { ...current, status: "drafted", pickup });

  console.log(`Drafted ${plan.meals.length} meals for ${newStart} to ${newEnd}. ${notes.join(" ")}`);
  await status(supabase, { status: "done", message: `Drafted ${plan.meals.length} meals for ${newStart} to ${newEnd}.` });
}

main().catch(async (err) => {
  console.error(err);
  try {
    await status(getSupabase(), { status: "error", message: err.message });
  } catch { /* already logged above */ }
  process.exit(1);
});
