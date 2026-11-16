// One-off/occasional job: bulk-upserts a staging JSON file (produced by
// tools/import_recipes.py or tools/import_paprika.py) into the Supabase
// `recipes` table. Run locally:
//
//   node --env-file=.env scripts/load-recipes.mjs .recipes-staging.json
//
// NYT rows carry their own ids and upsert by `id`. Rows without an id (e.g.
// Paprika) upsert by `source_uid` and get a new id from the table's sequence,
// so re-running either file updates rows in place.
import { readFileSync } from "fs";
import { getSupabase } from "./lib/supabaseClient.mjs";

const BATCH_SIZE = 500;

function upsertOptions(recipes) {
  if (recipes.every((r) => r.id != null)) return { onConflict: "id" };
  if (recipes.every((r) => r.id == null && r.source_uid)) return { onConflict: "source_uid", defaultToNull: false };
  throw new Error("Every recipe needs an id, or none may have one and every recipe needs a source_uid.");
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/load-recipes.mjs <path-to-staging.json>");
    process.exit(1);
  }

  const recipes = JSON.parse(readFileSync(path, "utf-8"));
  const options = upsertOptions(recipes);
  const supabase = getSupabase();

  for (let i = 0; i < recipes.length; i += BATCH_SIZE) {
    const batch = recipes.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("recipes").upsert(batch, options);
    if (error) throw error;
    console.log(`Upserted ${Math.min(i + BATCH_SIZE, recipes.length)}/${recipes.length}`);
  }

  console.log(`Done. Loaded ${recipes.length} recipes into Supabase.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
