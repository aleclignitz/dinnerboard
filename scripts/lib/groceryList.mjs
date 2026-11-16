import { askClaude, parseClaudeJson } from "./claude.mjs";

// Ingredients can be plain strings or nested group objects depending on the
// recipe source - flatten everything down to plain strings before trimming.
function flattenIngredient(i) {
  if (typeof i === "string") return [i];
  if (i && typeof i === "object") {
    if (Array.isArray(i.items)) return i.items.flatMap(flattenIngredient);
    if (typeof i.text === "string") return [i.text];
    if (typeof i.name === "string") return [i.quantity ? `${i.quantity} ${i.name}` : i.name];
  }
  return [];
}

// Word matching can't tell "2 lb ground beef" needs buying despite a freezer
// entry reading "Ground beef, 1 lb", so Claude reconciles quantities/spices
// instead. Falls back to the raw, unfiltered list if the call fails.
export async function trimIngredientsAgainstPantry({ ingredients, staples, freezer }) {
  const flat = ingredients.flatMap(flattenIngredient);
  if (!flat.length) return flat;
  const system = "You trim a merged recipe ingredient list down to what still needs to be bought, and output ONLY valid JSON, no prose.";
  const prompt = `Raw recipe ingredients for this week's meals (combined across recipes, may include duplicates/overlaps - merge those into one line):
${JSON.stringify(flat)}

Pantry staples, with status ("have" = stocked, "low"/"unknown" = buy it): ${JSON.stringify(staples)}

Freezer inventory on hand, with quantities: ${JSON.stringify(freezer)}

Drop any ingredient fully covered by a "have" staple (e.g. skip salt, pepper, common spices, cooking oil, soy sauce) or by freezer stock that covers the amount needed this week. If multiple recipes need more of something than the freezer has (e.g. two recipes need 1 lb ground beef each but the freezer only has 1 lb), keep a line for the remaining amount instead of dropping it entirely. Merge duplicate/overlapping ingredients into one line with a combined quantity. Do not invent items that weren't in the raw list, and do not drop anything you're unsure about - buying a small duplicate is fine, missing an ingredient is not.

Return JSON with exactly this shape:
{"items": ["item 1", "item 2"]}`;
  try {
    const raw = await askClaude({ system, prompt, maxTokens: 1500 });
    const parsed = parseClaudeJson(raw);
    return Array.isArray(parsed.items) && parsed.items.length ? parsed.items : flat;
  } catch (err) {
    console.error("Pantry trim failed, falling back to the unfiltered ingredient list:", err);
    return flat;
  }
}

const section = (title, items) => (items.length ? ["", title, ...items.map((i) => `- ${i}`)] : []);

// Formats the order hand-off text saved behind the board's Copy list button.
// Pure, so the exact wording is unit-tested.
export function formatOrderText({ ingredients, grocery = [], lowStaples = [], settings, ad, pickup = "" }) {
  const timing = settings.orderMethod === "pickup" ? `, with an afternoon pickup (${settings.pickupWindow} if available)` : ", for delivery";
  const lines = [
    `Please build a ${settings.storeName} order${pickup ? ` for ${pickup}` : ""}${timing}, with these items:`,
    "",
    "Recipe ingredients:",
    ...ingredients.map((i) => `- ${i}`),
    ...section("Quick adds:", grocery.map((g) => g.text)),
    ...section("Staples running low:", lowStaples.map((s) => s.name))
  ];
  if (ad && ad.ok) lines.push(...section("Coupons to clip (Tom Thumb weekly ad):", ad.coupons || []));
  else lines.push("", "Note: this week's Tom Thumb ad could not be retrieved - no sale-based substitutions were applied.");
  lines.push("", `${settings.substitutionRules} Leave the order for me to review before it's placed.`);
  return lines.join("\n");
}

// Builds the full order for a set of meals: merges and trims their
// ingredients against the pantry, then adds quick adds, low staples and
// coupons. `included` records which quick adds/staples the board clears or
// restocks when the order is marked placed.
export async function buildOrder({ meals, grocery, staples, freezer, settings, ad, pickup }) {
  const lowStaples = staples.filter((s) => s.status === "low");
  const ingredients = await trimIngredientsAgainstPantry({
    ingredients: meals.flatMap((m) => (m.recipe && m.recipe.ingredients) || []),
    staples,
    freezer
  });
  return {
    orderText: formatOrderText({ ingredients, grocery, lowStaples, settings, ad, pickup }),
    included: { grocery: grocery.map((g) => g.id), staples: lowStaples.map((s) => s.id) },
    itemCount: ingredients.length + grocery.length + lowStaples.length
  };
}
