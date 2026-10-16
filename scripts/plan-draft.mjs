// Wednesday job (runs after fetch-weekly-ad): promotes a due draft into the
// live plan, then drafts the next two weeks when the pickup date is close
// enough. Ported from automation/1-plan-draft-task.md, minus the Gmail
// order-check step (STEP 1B). Cook-night recipes come from the Supabase
// recipes dataset via a deterministic picker + Claude review
// (lib/recipePicker.mjs), falling back to free-form generation only if
// nothing in the dataset fits.
import { getSupabase, getDoc, getCollection, setDoc, deleteDoc } from "./lib/supabaseClient.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";
import { selectRecipeForMeal, generateFreeformRecipe } from "./lib/recipePicker.mjs";

const TIME_ZONE = process.env.PLAN_TIME_ZONE || "America/Chicago";
const GUIDELINES = process.env.PLAN_GUIDELINES || "";
const MAX_COOK_MINUTES = Number(process.env.PLAN_MAX_COOK_MINUTES || 45);

function todayInZone() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function latestSundayOnOrBefore(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

async function main() {
  const supabase = getSupabase();

  // Off by default: the board's "Turn on automation" button must set
  // enabled:true before any processing or Anthropic calls happen here.
  const automation = await getDoc(supabase, "settings/automation");
  if (!automation || automation.enabled !== true) {
    console.log("Automation is off (default). Turn it on from the board to enable weekly plan drafts. Skipping.");
    return;
  }

  const today = todayInZone();
  const notes = [];

  // STEP 1: housekeeping - promote a due draft into the live plan
  let draftMeals = await getCollection(supabase, "draft");
  if (draftMeals.length) {
    const earliest = draftMeals.map((m) => m.date).sort()[0];
    if (earliest <= today) {
      const meals = await getCollection(supabase, "meals");
      for (const m of meals) {
        const { id, ...rest } = m;
        await setDoc(supabase, `history/${id}`, rest);
        await deleteDoc(supabase, `meals/${id}`);
      }
      for (const m of draftMeals) {
        const { id, swapOut, ...rest } = m;
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
      notes.push("Promoted the drafted plan to active.");
    }
  }

  // STEP 2: is a draft due?
  draftMeals = await getCollection(supabase, "draft");
  if (draftMeals.length) {
    console.log("Draft already pending, nothing to do.", notes.join(" "));
    return;
  }
  const meals = await getCollection(supabase, "meals");
  const planEnd = meals.length ? meals.map((m) => m.date).sort().slice(-1)[0] : today;
  const newStart = addDays(planEnd, 1);
  const pickup = latestSundayOnOrBefore(newStart);
  const daysUntilPickup = (new Date(pickup) - new Date(today)) / 86400000;
  if (!(daysUntilPickup <= 7 && daysUntilPickup >= -2)) {
    console.log(`Next draft not due until closer to ${pickup}.`, notes.join(" "));
    return;
  }
  const newEnd = addDays(pickup, 14);

  // STEP 3: gather context
  const history = await getCollection(supabase, "history");
  const ideas = await getCollection(supabase, "ideas");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const freezer = await getCollection(supabase, "freezer");
  const current = (await getDoc(supabase, "plan/current")) || {};
  const guidelines = current.guidelines || GUIDELINES;
  const ad = await getDoc(supabase, "ads/current");
  const saleSummary = ad && ad.ok && ad.proteinDeals && ad.proteinDeals.length
    ? ad.proteinDeals.map((p) => `${p.protein}: ${p.items.join("; ")}`).join(" | ")
    : "(no sale data this week)";

  // STEP 4-6: ask Claude to draft the plan skeleton as JSON
  const system = "You write a two-week household dinner plan as strict JSON only, no prose, no markdown fences.";
  const prompt = `Household guidelines: ${guidelines}
Plan range: ${newStart} to ${newEnd}. Pickup day: ${pickup}.
Default rhythm: cook Mon/Wed/Fri, leftovers Tue/Thu/Sat, flexible Sunday.
Recent history with ratings (bring back 4-5 star meals at most twice, never repeat 1-2 star meals): ${JSON.stringify(history.slice(-30))}
Requests to address: ${JSON.stringify(ideas)}
Freezer on hand (use first): ${JSON.stringify(freezer)}
Staples (skip "have" items from the grocery list): ${JSON.stringify(staples)}
Quick-add groceries already requested: ${JSON.stringify(grocery)}
This week's grocery sale highlights (lean toward these proteins for cook nights when they fit the guidelines and recent history, but don't force a mismatch): ${saleSummary}

For every "cook" night, set "protein" to one of chicken, beef, pork, turkey, lamb, fish, vegetarian - rotate these across the two weeks per the guidelines (recipes themselves are picked separately from a fixed dataset, so do not write ingredients/steps for cook nights). For any "flex" night with a specific dish in mind, write a full "recipe" as shown below instead. "leftovers" nights need neither. Week 2 meals using a protein bought at pickup need a "thaw" field describing what to move from freezer to fridge the night before.

Return JSON with exactly this shape:
{
  "meals": [{"date":"YYYY-MM-DD","kind":"cook|leftovers|flex","details":"","from":"","thaw":"","protein":"","recipe":null}],
  "summary": "1-2 sentences: what's new and what's returning",
  "prep": "Freeze on arrival: ...",
  "groceries": [{"section":"Proteins, use fresh (week 1)","items":[""]}]
}`;

  const raw = await askClaude({ system, prompt, maxTokens: 8000 });
  const plan = parseClaudeJson(raw);

  // STEP 5b: fill in a real recipe for every cook night, from the Supabase
  // recipes dataset when possible (deterministic pick + Claude review),
  // falling back to free-form generation only if nothing fits.
  const context = { history: history.slice(-30), freezer, staples };
  const usedRecipeIds = history.map((m) => m.sourceRecipeId).filter(Boolean);
  for (const meal of plan.meals) {
    if (meal.kind !== "cook") {
      delete meal.protein;
      continue;
    }
    const selection = await selectRecipeForMeal(supabase, {
      date: meal.date,
      kind: meal.kind,
      protein: meal.protein,
      maxTime: MAX_COOK_MINUTES,
      guidelines,
      context,
      excludeIds: usedRecipeIds
    });
    if (selection) {
      meal.title = selection.title;
      meal.sourceRecipeId = selection.sourceRecipeId;
      meal.details = selection.details || meal.details || "";
      meal.thaw = selection.thaw || meal.thaw || "";
      meal.recipe = selection.recipe;
      usedRecipeIds.push(selection.sourceRecipeId);
    } else {
      const fallback = await generateFreeformRecipe({ date: meal.date, kind: meal.kind, guidelines, context });
      meal.title = fallback.title;
      meal.details = fallback.details || meal.details || "";
      meal.thaw = fallback.thaw || meal.thaw || "";
      meal.recipe = fallback.recipe;
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
