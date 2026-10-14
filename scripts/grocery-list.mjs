// Thursday job: finalizes any meals marked "Replace", builds one grocery
// list, and saves it on the board behind the Copy list button. Ported from
// automation/2-grocery-list-task.md, minus the Google Drive save (STEP 4) -
// Muse (or any agent) picks the list up via the board's Copy list button
// for now instead of a Drive doc.
import { getSupabase, getDoc, getCollection, setDoc } from "./lib/supabaseClient.mjs";
import { askClaude } from "./lib/claude.mjs";

const STORE = process.env.STORE_NAME || "Walmart pickup";
const SUBSTITUTION_RULES = process.env.SUBSTITUTION_RULES || "Store-brand substitutions are fine.";

async function main() {
  const supabase = getSupabase();
  const current = (await getDoc(supabase, "plan/current")) || {};
  const draftPlan = await getDoc(supabase, "plan/draft");

  // STEP 1: is a list due?
  if (!draftPlan || !["drafted", "approved"].includes(current.status)) {
    console.log("No list due this week.");
    return;
  }

  // STEP 2: replace any meal marked swapOut
  const draftMeals = await getCollection(supabase, "draft");
  const toSwap = draftMeals.filter((m) => m.swapOut);
  for (const m of toSwap) {
    const notes = (await getCollection(supabase, "notes")).filter((n) => n.meal === m.id);
    const ideas = await getCollection(supabase, "ideas");
    const prompt = `Replace this meal with a different ${m.kind} meal for ${m.date}, following these guidelines: ${current.guidelines || ""}.
Notes on the meal being replaced: ${JSON.stringify(notes)}
Open requests: ${JSON.stringify(ideas)}
Use safe internal temperatures (poultry 165F, fish 145F).
Return JSON only: {"title":"","details":"","recipe":{"serves":0,"time":0,"oven":"","ingredients":[""],"steps":[""],"tip":""}}`;
    const raw = await askClaude({ system: "Output ONLY valid JSON, no prose.", prompt, maxTokens: 2000 });
    const replacement = JSON.parse(raw);
    await setDoc(supabase, `draft/${m.id}`, { ...m, ...replacement, swapOut: false });
  }

  // STEP 3: build the order list (naive ingredient merge - refine later)
  const finalMeals = await getCollection(supabase, "draft");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const lowStaples = staples.filter((s) => s.status === "low");
  const allIngredients = finalMeals.flatMap((m) => (m.recipe && m.recipe.ingredients) || []);
  const pickupLabel = draftPlan.pickup || "this Sunday";

  const lines = [];
  lines.push(`Please build a ${STORE} order for ${pickupLabel}, with an afternoon pickup (1-4 PM if available), with these items:`);
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
