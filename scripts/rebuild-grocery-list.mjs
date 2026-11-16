// Manual recovery: rebuilds the shopping list for the current active plan
// (the "meals" collection), for when plan/draft was promoted away before its
// grocery list got copied. Prints it and saves it where grocery-list.mjs
// does (plan/draft + plan/current list_ready), so it shows up on the board.
//
//   node --env-file=.env scripts/rebuild-grocery-list.mjs
//
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
import { buildOrder } from "./lib/groceryList.mjs";
import { loadSettings } from "./lib/settings.mjs";

async function main() {
  const supabase = getSupabase();
  const meals = await getCollection(supabase, "meals");
  if (!meals.length) throw new Error("No meals found in the active plan.");

  const { orderText, included, itemCount } = await buildOrder({
    meals,
    grocery: await getCollection(supabase, "grocery"),
    staples: await getCollection(supabase, "staples"),
    freezer: await getCollection(supabase, "freezer"),
    settings: await loadSettings(supabase),
    ad: await getDoc(supabase, "ads/current")
  });
  console.log(orderText);

  const current = (await getDoc(supabase, "plan/current")) || {};
  const draftPlan = (await getDoc(supabase, "plan/draft")) || {};
  await setDoc(supabase, "plan/draft", { ...draftPlan, orderText, included });
  await setDoc(supabase, "plan/current", { ...current, status: "list_ready", statusNote: `${itemCount} items (recovered).` });
  console.log(`\nSaved to the board - check the Shopping tab. ${itemCount} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
