// One-off/occasional job: bulk-upserts a staging JSON file (produced by
// tools/import_recipes.py) into the Supabase `recipes` table. Run locally:
//
//   node --env-file=.env scripts/load-recipes.mjs .recipes-staging.json
//
import { readFileSync } from "fs";
import { getSupabase } from "./lib/supabaseClient.mjs";

const BATCH_SIZE = 500;

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/load-recipes.mjs <path-to-staging.json>");
    process.exit(1);
  }

  const recipes = JSON.parse(readFileSync(path, "utf-8"));
  const supabase = getSupabase();

  for (let i = 0; i < recipes.length; i += BATCH_SIZE) {
    const batch = recipes.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("recipes").upsert(batch, { onConflict: "id" });
    if (error) throw error;
    console.log(`Upserted ${Math.min(i + BATCH_SIZE, recipes.length)}/${recipes.length}`);
  }

  console.log(`Done. Loaded ${recipes.length} recipes into Supabase.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
