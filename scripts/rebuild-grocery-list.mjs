// One-off recovery: rebuilds the shopping list for the current active plan
// (the "meals" collection), for when plan/draft was promoted away before
// its grocery list got copied. Prints it, and also writes it to plan/draft
// + sets plan/current to list_ready so it shows up on the board itself
// (same place/shape the normal grocery-list.mjs run leaves it). Run locally:
//
//   node --env-file=.env scripts/rebuild-grocery-list.mjs
//
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
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
  const orderText = lines.join("\n");

  console.log(orderText);

  const current = (await getDoc(supabase, "plan/current")) || {};
  const draftPlan = (await getDoc(supabase, "plan/draft")) || {};
  await setDoc(supabase, "plan/draft", {
    ...draftPlan,
    orderText,
    included: { grocery: grocery.map((g) => g.id), staples: lowStaples.map((s) => s.id) }
  });
  const itemCount = ingredients.length + grocery.length + lowStaples.length;
  await setDoc(supabase, "plan/current", { ...current, status: "list_ready", statusNote: `${itemCount} items (recovered).` });
  console.log(`\nSaved to the board - check the Shop tab. ${itemCount} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);

});
