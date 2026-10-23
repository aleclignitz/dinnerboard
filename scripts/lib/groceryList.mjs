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
