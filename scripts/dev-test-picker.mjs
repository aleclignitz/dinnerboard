// Manual smoke test for the recipe picker - not part of the scheduled jobs.
// Usage: node --env-file=.env scripts/dev-test-picker.mjs
import { getSupabase } from "./lib/supabaseClient.mjs";
import { pickCandidates, selectRecipeForMeal } from "./lib/recipePicker.mjs";

async function main() {
  const supabase = getSupabase();

  console.log("--- pickCandidates (deterministic, no Claude call) ---");
  const { candidates, usedFilters } = await pickCandidates(supabase, {
    protein: "chicken",
    maxTime: 45,
    excludeIds: []
  });
  console.log("usedFilters:", usedFilters);
  console.log(candidates.map((c) => `${c.id}: ${c.title} (${c.time_minutes}m, ${c.rating}*)`));

  console.log("\n--- selectRecipeForMeal (includes a Claude review call) ---");
  const selection = await selectRecipeForMeal(supabase, {
    date: "2026-10-20",
    kind: "cook",
    protein: "chicken",
    maxTime: 45,
    guidelines: process.env.PLAN_GUIDELINES || "Family-friendly weeknight dinners, 40 minutes or less.",
    context: { history: [], freezer: [], staples: [] },
    excludeIds: []
  });
  console.log(JSON.stringify(selection, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
