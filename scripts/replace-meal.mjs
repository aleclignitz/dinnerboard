// Started by the board's Replace button: swaps in a new recipe for every
// draft meal marked swapOut right away, so it shows in the plan before the
// grocery list is built.
//
// Locally, pass a draft meal id to mark it and replace it in one go (handy
// for previewing a new pick; this skips the automation switch):
//
//   node --env-file=.env scripts/replace-meal.mjs <draft-meal-id>
//
import { getSupabase, getDoc, setDoc } from "./lib/supabaseClient.mjs";
import { loadSettings, automationEnabled } from "./lib/settings.mjs";
import { replaceMarkedMeals } from "./lib/replaceMeals.mjs";

async function main() {
  const supabase = getSupabase();
  const id = process.argv[2];
  if (id) {
    const meal = await getDoc(supabase, `draft/${id}`);
    if (!meal) throw new Error(`No draft meal found at draft/${id}`);
    await setDoc(supabase, `draft/${id}`, { ...meal, swapOut: true });
  } else if (!(await automationEnabled(supabase))) {
    console.log("Automation is off. Skipping.");
    return;
  }
  const settings = await loadSettings(supabase);
  const n = await replaceMarkedMeals(supabase, {
    current: (await getDoc(supabase, "plan/current")) || {},
    ad: await getDoc(supabase, "ads/current"),
    maxCookMinutes: settings.maxCookMinutes,
    guidelines: settings.planGuidelines
  });
  console.log(`Replaced ${n} meal(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
