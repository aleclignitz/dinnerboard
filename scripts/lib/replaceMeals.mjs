// Replaces every draft meal marked swapOut with a fresh pick, honoring the
// optional swapNote ("no fish", "a pork dish"). Shared by replace-meal.mjs
// (runs right after the board's Replace button) and grocery-list.mjs (safety net).
import { getCollection, setDoc } from "./supabaseClient.mjs";
import { pickRecipe } from "./recipePicker.mjs";

export async function replaceMarkedMeals(supabase, { current = {}, ad, maxCookMinutes, guidelines = "" }) {
  const draftMeals = await getCollection(supabase, "draft");
  const toSwap = draftMeals.filter((m) => m.swapOut);
  if (!toSwap.length) return 0;
  const history = await getCollection(supabase, "history");
  const freezer = await getCollection(supabase, "freezer");
  const ideas = await getCollection(supabase, "ideas");
  const allNotes = await getCollection(supabase, "notes");
  const usedRecipeIds = [...draftMeals, ...history].map((m) => m.sourceRecipeId).filter(Boolean);
  const effectiveGuidelines = guidelines || current.guidelines || "";

  for (const m of toSwap) {
    const notes = allNotes.filter((n) => n.meal === m.id);
    const context = { history: [...history.slice(-30), ...notes], freezer, ideas, saleDeals: ad && ad.ok ? ad.deals : [] };
    const replacement = await pickRecipe(supabase, {
      date: m.date,
      kind: m.kind,
      maxTime: maxCookMinutes,
      guidelines: effectiveGuidelines,
      context,
      excludeIds: usedRecipeIds,
      request: (m.swapNote || "").trim(),
      avoidTitle: m.title
    });
    if (replacement.sourceRecipeId) usedRecipeIds.push(replacement.sourceRecipeId);
    // Drop the old pick's sourceRecipeId so a free-form replacement isn't mislabeled.
    const { swapNote, sourceRecipeId, ...rest } = m;
    await setDoc(supabase, `draft/${m.id}`, { ...rest, ...replacement, swapOut: false });
    console.log(`Replaced draft/${m.id}: "${m.title}" -> "${replacement.title}"${replacement.sourceRecipeId ? ` (recipe #${replacement.sourceRecipeId})` : " (free-form)"}`);
  }
  return toSwap.length;
}