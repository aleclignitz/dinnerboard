#!/usr/bin/env python3
"""Convert an nyt-cooking-parser sqlite export into a staging JSON file shaped
for the Supabase `recipes` table (see sql/schema.sql). Load it with:

    python3 tools/import_recipes.py <path-to-recipes.db> > .recipes-staging.json
    node scripts/load-recipes.mjs .recipes-staging.json

The staging file is gitignored - recipes live in Supabase, not this repo.

Usage:  python3 tools/import_recipes.py <path-to-recipes.db> [output-path]
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def parse_serves(recipe_yield):
    if not recipe_yield:
        return None
    match = re.search(r"\d+", recipe_yield)
    return int(match.group()) if match else None


def normalize_url(url):
    return "https:" + url if url and url.startswith("//") else url


# Exact tag strings (lowercased) observed in the source dataset for each
# protein category. Substring matching is deliberately avoided - it produced
# false positives like "ham" inside "graham cracker" or "fish" inside "fish sauce".
PROTEIN_TAGS = [
    ("chicken", {"chicken", "chicken thigh", "chicken thighs", "chicken breast", "roast chicken"}),
    ("beef", {"beef", "ground beef", "beef stew meat", "beef tenderloin", "beef roast", "steak",
              "flank steak", "skirt steak", "tri-tip steak", "steaks and chops"}),
    ("pork", {"pork", "pork shoulder", "pork chop", "ground pork", "salt pork"}),
    ("turkey", {"turkey", "ground turkey", "whole turkey", "turkey stock"}),
    ("lamb", {"lamb", "ground lamb", "lamb shoulder", "lamb shanks", "leg of lamb"}),
    ("fish", {"fish", "seafood", "shrimp", "salmon", "salmon fillet", "smoked salmon", "canned tuna",
              "tuna", "tuna salad", "fish fillet", "white fish", "swordfish", "scallop", "scallops",
              "crab", "lobster", "cod", "halibut"}),
    ("vegetarian", {"vegetarian", "vegetarian thanksgiving", "vegan", "vegan thanksgiving",
                     "vegan ground meat", "tofu", "extra-firm tofu", "silken tofu", "firm tofu", "tofu dish"}),
]


def classify_course(tags):
    tl = {t.lower() for t in tags}
    if "main course" in tl or "dinner" in tl:
        return "entree"
    if "side dish" in tl:
        return "side"
    return "other"


def classify_protein(tags):
    tl = {t.lower() for t in tags}
    for category, exact_tags in PROTEIN_TAGS:
        if tl & exact_tags:
            return category
    return None


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python3 tools/import_recipes.py <path-to-recipes.db> [output-path]")
        sys.exit(1)

    con = sqlite3.connect(sys.argv[1])
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    tags_by_recipe = {}
    for row in cur.execute(
        "SELECT rt.recipe_id AS recipe_id, t.name AS name "
        "FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id"
    ):
        tags_by_recipe.setdefault(row["recipe_id"], []).append(row["name"])

    recipes = []
    for row in cur.execute("SELECT * FROM recipes ORDER BY name"):
        tags = sorted(tags_by_recipe.get(row["id"], []))
        recipes.append({
            "id": row["id"],
            "title": row["name"],
            "url": normalize_url(row["url"]),
            "description": row["description"],
            "tags": tags,
            "course": classify_course(tags),
            "protein": classify_protein(tags),
            "rating": row["rating"],
            "rating_count": row["ratingCount"],
            "serves": parse_serves(row["recipeYield"]),
            "time_minutes": row["totalTimeMinutes"],
            "oven": "",
            "ingredients": json.loads(row["ingredients"]) if row["ingredients"] else [],
            "steps": json.loads(row["instructions"]) if row["instructions"] else [],
            "tip": "",
        })

    out = ROOT / (sys.argv[2] if len(sys.argv) == 3 else ".recipes-staging.json")
    out.write_text(json.dumps(recipes, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(recipes)} recipes to {out}")


if __name__ == "__main__":
    main()
