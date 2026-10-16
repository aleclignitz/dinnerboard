// Manual re-run of the swap pipeline for a single meal - not part of the
// scheduled jobs. Lets you preview a new pick after tapping "Replace this
// meal" on the board, without running the full Thursday grocery-list job.
// Usage: node --env-file=.env scripts/dev-swap-meal.mjs <draft-meal-id>
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
import { selectRecipeForMeal, generateFreeformRecipe } from "./lib/recipePicker.mjs";

const MAX_COOK_MINUTES = Number(process.env.PLAN_MAX_COOK_MINUTES || 45);

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: node --env-file=.env scripts/dev-swap-meal.mjs <draft-meal-id>");
    process.exit(1);
  }

  const supabase = getSupabase();
  const current = (await getDoc(supabase, "plan/current")) || {};
  const m = await getDoc(supabase, `draft/${id}`);
  if (!m) {
    console.error(`No draft meal found at draft/${id}`);
    process.exit(1);
  }

  const draftMeals = await getCollection(supabase, "draft");
  const history = await getCollection(supabase, "history");
  const freezer = await getCollection(supabase, "freezer");
  const notes = (await getCollection(supabase, "notes")).filter((n) => n.meal === id);
  const ideas = await getCollection(supabase, "ideas");
  const usedRecipeIds = [...draftMeals, ...history].map((x) => x.sourceRecipeId).filter(Boolean);
  const context = { history: [...history.slice(-30), ...notes], freezer, ideas };

  let replacement;
  if (m.kind === "cook") {
    const selection = await selectRecipeForMeal(supabase, {
      date: m.date,
      kind: m.kind,
      maxTime: MAX_COOK_MINUTES,
      guidelines: current.guidelines || "",
      context,
      excludeIds: usedRecipeIds
    });
    if (selection) replacement = selection;
  }
  if (!replacement) {
    replacement = await generateFreeformRecipe({ date: m.date, kind: m.kind, guidelines: current.guidelines || "", context });
  }

  console.log("before:", m.title);
  console.log("after:", replacement.title, replacement.sourceRecipeId ? `(recipe #${replacement.sourceRecipeId})` : "(free-form)");
  console.log(JSON.stringify(replacement, null, 2));

  await setDoc(supabase, `draft/${id}`, { ...m, ...replacement, swapOut: false });
  console.log(`Saved to draft/${id}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
