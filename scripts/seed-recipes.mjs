// Generates starter recipes with Claude and upserts them into `recipes`.
// Triggered from the board's Settings tab (via the seed-recipes workflow).
// Progress is written to settings/seed so the board can show it.
import { getSupabase, setDoc } from "./lib/supabaseClient.mjs";
import { askClaude, parseClaudeJson } from "./lib/claude.mjs";
import { loadSettings } from "./lib/settings.mjs";
import {
  GENERATED_ID_FLOOR, BATCH_SIZE, proteinPlan, chunk, buildSeedPrompt, validateRecipe, toRow, dedupeNew
} from "./lib/seedRecipes.mjs";

const COUNT = Number(process.env.SEED_RECIPE_COUNT || 14); // about two weeks of cook nights

async function status(supabase, patch) {
  try {
    await setDoc(supabase, "settings/seed", { ...patch, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Couldn't write seed status:", err.message);
  }
}

async function main() {
  const supabase = getSupabase();
  await status(supabase, { status: "running", message: "Writing recipes…" });
  const settings = await loadSettings(supabase);

  const { data: existing, error } = await supabase.from("recipes").select("id,title").gte("id", GENERATED_ID_FLOOR);
  if (error) throw error;
  let nextId = Math.max(GENERATED_ID_FLOOR, ...existing.map((r) => r.id)) + 1;
  const titles = existing.map((r) => r.title);

  const saved = [];
  for (const proteins of chunk(proteinPlan(COUNT), BATCH_SIZE)) {
    try {
      const raw = await askClaude({
        system: "You write dinner recipes as strict JSON only, no prose, no markdown fences.",
        prompt: buildSeedPrompt({ proteins, guidelines: settings.planGuidelines, maxCookMinutes: settings.maxCookMinutes, avoidTitles: titles }),
        maxTokens: 6000
      });
      const parsed = parseClaudeJson(raw);
      const valid = (Array.isArray(parsed.recipes) ? parsed.recipes : [])
        .map((r) => validateRecipe(r, { maxCookMinutes: settings.maxCookMinutes }))
        .filter(Boolean);
      const rows = dedupeNew(valid, titles).map((r) => toRow(r, nextId++));
      if (rows.length) {
        const { error: upErr } = await supabase.from("recipes").upsert(rows, { onConflict: "id" });
        if (upErr) throw upErr;
        saved.push(...rows);
        titles.push(...rows.map((r) => r.title));
      }
      console.log(`Batch of ${proteins.length}: saved ${rows.length}`);
    } catch (err) {
      console.error(`Batch failed, continuing: ${err.message}`);
    }
  }

  if (!saved.length) throw new Error("No recipes could be generated. Check the ANTHROPIC_API_KEY secret and the workflow log.");
  await status(supabase, { status: "done", count: saved.length, message: `Added ${saved.length} starter recipes.` });
  console.log(`Done: ${saved.length} recipes added.`);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await status(getSupabase(), { status: "error", message: String(err.message || err).slice(0, 300) });
  } catch {}
  process.exit(1);
});
