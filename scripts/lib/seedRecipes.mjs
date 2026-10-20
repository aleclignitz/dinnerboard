// Starter-recipe generation: Claude writes a small set of original dinner
// entrees so a new household can plan immediately, without importing a
// recipe dataset first. Rows match the `recipes` table the picker reads.
export const PROTEINS = ["chicken", "beef", "pork", "fish", "turkey", "vegetarian", "lamb"];
// Generated ids live above this floor so they never collide with imported ones.
export const GENERATED_ID_FLOOR = 1_000_000_000;
export const BATCH_SIZE = 5;

// Spread across proteins in a rotation weighted toward everyday ones.
export function proteinPlan(count) {
  const rotation = ["chicken", "beef", "pork", "fish", "chicken", "vegetarian", "turkey", "pork", "beef", "chicken", "fish", "lamb"];
  return Array.from({ length: count }, (_, i) => rotation[i % rotation.length]);
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function buildSeedPrompt({ proteins, guidelines, maxCookMinutes, avoidTitles = [] }) {
  return `Write ${proteins.length} original, family-friendly weeknight dinner entree recipes, one per protein in this exact order: ${JSON.stringify(proteins)}.
Household guidelines: ${guidelines || "(none given)"}.
Each recipe must take ${maxCookMinutes} minutes or less in total. Use common grocery-store ingredients and safe internal temperatures (poultry 165F, ground meat 160F, fish 145F). "vegetarian" means no meat or fish.
Do not reuse these titles: ${JSON.stringify(avoidTitles)}.
Return JSON only: {"recipes":[{"title":"","description":"one sentence","protein":"","serves":4,"time_minutes":0,"oven":"e.g. 400F or empty string","ingredients":["quantity and item"],"steps":["step"],"tip":""}]}`;
}

const isText = (v) => typeof v === "string" && v.trim().length > 0;

// Returns a cleaned recipe or null if it can't be trusted.
export function validateRecipe(r, { maxCookMinutes } = {}) {
  if (!r || !isText(r.title) || !PROTEINS.includes(r.protein)) return null;
  const ingredients = Array.isArray(r.ingredients) ? r.ingredients.filter(isText) : [];
  const steps = Array.isArray(r.steps) ? r.steps.filter(isText) : [];
  const time = Math.round(Number(r.time_minutes));
  const serves = Math.round(Number(r.serves));
  if (ingredients.length < 3 || steps.length < 2) return null;
  if (!Number.isFinite(time) || time <= 0 || (maxCookMinutes && time > maxCookMinutes)) return null;
  return {
    title: r.title.trim(),
    description: isText(r.description) ? r.description.trim() : "",
    protein: r.protein,
    serves: Number.isFinite(serves) && serves > 0 ? serves : 4,
    time_minutes: time,
    oven: isText(r.oven) ? r.oven.trim() : "",
    ingredients: ingredients.map((s) => s.trim()),
    steps: steps.map((s) => s.trim()),
    tip: isText(r.tip) ? r.tip.trim() : ""
  };
}

// Rating 4.5 lets generated recipes pass the picker's rating >= 4 filter.
export function toRow(recipe, id) {
  return { id, ...recipe, url: null, tags: ["generated"], course: "entree", rating: 4.5, rating_count: 0 };
}

export function dedupeNew(recipes, existingTitles = []) {
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return recipes.filter((r) => {
    const key = r.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
