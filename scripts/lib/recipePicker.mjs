// Deterministic recipe candidate selection against Supabase's `recipes`
// table, plus a Claude review step that picks one candidate (or rejects all)
// and fills in thaw instructions. Used by plan-draft.mjs and grocery-list.mjs
// so cook-night recipes come from the fixed dataset instead of being
// invented from scratch every time.
import { askClaude, parseClaudeJson } from "./claude.mjs";

const CANDIDATE_LIMIT = 10;

// Looser each time: drop the rating floor, then the time cap, then the
// protein requirement - in that order - until something matches.
function buildAttempts({ protein, maxTime }) {
  const attempts = [];
  const proteins = protein ? [protein, null] : [null];
  const times = maxTime ? [maxTime, null] : [null];
  const ratingFloors = [4, 0];
  for (const t of times) {
    for (const r of ratingFloors) {
      for (const p of proteins) {
        attempts.push({ protein: p, maxTime: t, minRating: r });
      }
    }
  }
  return attempts;
}

async function queryRecipes(supabase, { protein, maxTime, minRating, excludeIds, limit }) {
  let query = supabase.from("recipes").select("*").eq("course", "entree");
  if (protein) query = query.eq("protein", protein);
  if (maxTime) query = query.lte("time_minutes", maxTime);
  if (minRating) query = query.gte("rating", minRating);
  if (excludeIds.length) query = query.not("id", "in", `(${excludeIds.join(",")})`);
  const { data, error } = await query
    .order("rating", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Returns up to `limit` candidates, deterministic for a given db state and
// exclude set (stable sort: rating desc, id asc tie-break).
export async function pickCandidates(supabase, { protein, maxTime, excludeIds = [], limit = CANDIDATE_LIMIT }) {
  for (const attempt of buildAttempts({ protein, maxTime })) {
    const candidates = await queryRecipes(supabase, { ...attempt, excludeIds, limit });
    if (candidates.length) return { candidates, usedFilters: attempt };
  }
  return { candidates: [], usedFilters: null };
}

function summarizeCandidate(c) {
  return {
    id: c.id,
    title: c.title,
    tags: c.tags,
    rating: c.rating,
    ratingCount: c.rating_count,
    serves: c.serves,
    timeMinutes: c.time_minutes,
    ingredients: c.ingredients
  };
}

// Asks Claude to pick one candidate (or reject all), and write thaw
// instructions / a short details blurb for the chosen one.
async function chooseRecipeWithClaude({ candidates, date, kind, protein, guidelines, context }) {
  const system = "You review proposed dinner recipes against household guidelines and output ONLY valid JSON, no prose.";
  const prompt = `Household guidelines: ${guidelines || "(none given)"}
Meal date: ${date} (${kind} night${protein ? `, ${protein}` : ""}).
Context - recent history with ratings: ${JSON.stringify(context.history || [])}
Freezer on hand: ${JSON.stringify(context.freezer || [])}
Staples running low or out: ${JSON.stringify(context.staples || [])}
Sale deals this week (consider when choosing, not mandatory): ${JSON.stringify(context.saleDeals || [])}

Candidate recipes (choose the best fit, or reject all if none are a good fit):
${JSON.stringify(candidates.map(summarizeCandidate))}

Reject a candidate if it clashes with the guidelines (e.g. too spicy if that's disallowed, wrong protein for variety, repeats something recently rated low), duplicates a recent meal, or doesn't make sense for a weeknight.

If a protein in the ingredients needs to move from freezer to fridge the night before, write "thaw" describing what to thaw. Use safe internal temperatures (poultry 165F, fish 145F) in instructions.

Return JSON with exactly this shape:
{"accepted": true, "recipeId": 0, "details": "1-2 sentences on what to expect or serve alongside", "thaw": ""}
or, if none fit:
{"accepted": false, "reason": "short reason"}`;

  const raw = await askClaude({ system, prompt, maxTokens: 1000 });
  return parseClaudeJson(raw);
}

// Full pipeline for one meal slot: pick candidates, let Claude choose, retry
// with the rejected ids excluded, up to a couple of rounds. Returns a
// ready-to-store meal patch, or null if nothing was accepted (caller should
// fall back to free-form recipe generation).
export async function selectRecipeForMeal(supabase, { date, kind, protein, maxTime, guidelines, context = {}, excludeIds = [] }) {
  let excluded = [...excludeIds];
  for (let round = 0; round < 3; round++) {
    const { candidates } = await pickCandidates(supabase, { protein, maxTime, excludeIds: excluded });
    if (!candidates.length) return null;

    const choice = await chooseRecipeWithClaude({ candidates, date, kind, protein, guidelines, context });
    if (choice.accepted) {
      const picked = candidates.find((c) => c.id === choice.recipeId);
      if (picked) {
        return {
          title: picked.title,
          sourceRecipeId: picked.id,
          details: choice.details || "",
          thaw: choice.thaw || "",
          recipe: {
            serves: picked.serves,
            time: picked.time_minutes,
            oven: picked.oven,
            ingredients: picked.ingredients,
            steps: picked.steps,
            tip: picked.tip,
            url: picked.url || ""
          }
        };
      }
    }
    // Rejected (or Claude named an id not in the batch) - exclude this whole
    // batch and try again with a wider/looser query.
    excluded = excluded.concat(candidates.map((c) => c.id));
  }
  return null;
}

// Last-resort path when the dataset has no fit after a few rounds - same
// free-form generation the plan used before the dataset existed.
export async function generateFreeformRecipe({ date, kind, guidelines, context = {} }) {
  const system = "Output ONLY valid JSON, no prose.";
  const prompt = `Write an original ${kind} dinner recipe for ${date}, following these guidelines: ${guidelines || "(none given)"}.
Recent history with ratings: ${JSON.stringify(context.history || [])}
Freezer on hand: ${JSON.stringify(context.freezer || [])}
Use safe internal temperatures (poultry 165F, fish 145F).
Return JSON only: {"title":"","details":"","thaw":"","recipe":{"serves":0,"time":0,"oven":"","ingredients":[""],"steps":[""],"tip":""}}`;
  const raw = await askClaude({ system, prompt, maxTokens: 2000 });
  return parseClaudeJson(raw);
}
