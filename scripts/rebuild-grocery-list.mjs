// One-off recovery: rebuilds and prints the shopping list for the current
// active plan (the "meals" collection), for when plan/draft was promoted
// away before its grocery list got copied. Run locally:
//
//   node --env-file=.env scripts/rebuild-grocery-list.mjs
//
import { getSupabase, getCollection } from "./lib/supabaseClient.mjs";
import { loadSettings } from "./lib/settings.mjs";

async function main() {
  const supabase = getSupabase();
  const settings = await loadSettings(supabase);

  const meals = await getCollection(supabase, "meals");
  if (!meals.length) throw new Error("No meals found in the active plan.");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const lowStaples = staples.filter((s) => s.status === "low");
  const ingredients = meals.flatMap((m) => (m.recipe && m.recipe.ingredients) || []);

  const lines = [];
  const timing = settings.orderMethod === "pickup" ? `, with an afternoon pickup (${settings.pickupWindow} if available)` : ", for delivery";
  lines.push(`Please build a ${settings.storeName} order${timing}, with these items:`);
  lines.push("", "Recipe ingredients:");
  ingredients.forEach((i) => lines.push(`- ${i}`));
  if (grocery.length) {
    lines.push("", "Quick adds:");
    grocery.forEach((g) => lines.push(`- ${g.text}`));
  }
  if (lowStaples.length) {
    lines.push("", "Staples running low:");
    lowStaples.forEach((s) => lines.push(`- ${s.name}`));
  }
  lines.push("", `${settings.substitutionRules} Leave the order for me to review before it's placed.`);

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
