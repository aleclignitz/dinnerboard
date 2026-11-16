#!/usr/bin/env python3
"""Convert a Paprika export (.paprikarecipes) into a staging JSON file shaped
for the Supabase `recipes` table (see sql/schema.sql and sql/migrations/).
Load it with:

    python tools/import_paprika.py "<export>.paprikarecipes" .paprika-staging.json
    node --use-system-ca --env-file=.env scripts/load-recipes.mjs .paprika-staging.json

Re-running is safe: rows are matched on Paprika's uid (`source_uid`), so
edited recipes update in place and new ones get fresh ids. The staging file
is gitignored, and so are .paprikarecipes exports.

A .paprikarecipes file is a zip of gzipped JSON documents, one per recipe.
Paprika recipes rarely carry useful categories, so `course` and `protein`
are inferred from categories, the title and the ingredient list, letting the
weekly planner pick them alongside the NYT dataset.

Usage:  python tools/import_paprika.py <export.paprikarecipes> [output-path]
"""
import gzip
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Order matters: the first protein found wins (categories, then title, then
# ingredients). Fish comes first so "clams with bacon" and "tuna steaks" are fish.
PROTEIN_WORDS = [
    ("fish", ["fish", "seafood", "salmon", "tuna", "cod", "halibut", "trout", "snapper", "branzino",
              "swordfish", "tilapia", "mackerel", "sardines?", "shrimp", "prawns?", "scallops?",
              "clams?", "mussels?", "crab", "lobster", "squid", "calamari", "octopus"]),
    ("chicken", ["chicken", "drumsticks?", "wings?"]),
    ("turkey", ["turkey"]),
    ("lamb", ["lamb", "merguez"]),
    ("pork", ["pork", "bacon", "pancetta", "prosciutto", "guanciale", "ham", "sausages?", "chorizo",
              "kielbasa", "andouille", "pepperoni", "soppressata", "speck", "carnitas", "spare ?ribs",
              "baby back ribs", "salami", "mortadella", "morty-?d", "'?nduja"]),
    ("beef", ["beef", "steaks?", "flank", "skirt steak", "brisket", "short ribs?", "sirloin", "rib-?eye",
              "chuck", "pastrami", "burgers?", "meatballs?", "meat ?loaf", "bolognese", "ground meat"]),
]
# Phrases that name a protein without it being the dish's protein.
NOT_A_PROTEIN = re.compile(r"\b(fish sauce|(chicken|beef|fish|bone|turkey) (stock|broth|bouillon)|"
                           r"bacon fat|chicken fat|schmaltz|(cauliflower|cabbage|celery|mushroom|"
                           r"portobello|tofu|squash|eggplant)\s+steaks?)\b", re.I)
# Not a main protein, but still not vegetarian.
NOT_VEGETARIAN = re.compile(r"\b(anchov\w*|'chovies|fish sauce|oyster sauce|(chicken|beef|fish|bone|turkey) "
                            r"(stock|broth|bouillon)|schmaltz|gelatin|lard|worcestershire)\b", re.I)
TITLE_ONLY_PROTEIN = [("pork", re.compile(r"\bribs\b", re.I))]  # "celery ribs" only shows up in ingredients

ENTREE_CATS = {"dinners", "dinner", "main course", "main courses", "main dish", "main dishes", "meat",
               "chicken", "seafood", "fish", "beef", "pork", "lamb", "beef, pork & lamb", "pasta", "noods",
               "soup", "braised", "sandwich", "sandwiches", "burger", "pizza", "grilled", "roasted", "ballz"}
SIDE_CATS = {"side dish", "side dishes", "vegetables", "potatoes", "rice", "grains & legumes", "carbs",
             "so. many. veggies.", "salad", "salads", "salading", "lentils"}
OTHER_CATS = {"sweets", "sweet", "dessert", "desserts", "baking", "breakfast", "eggs", "appetizer",
              "appetizers", "snacks", "snack attack", "drinks", "sauces", "bread", "breads", "pie",
              "cakes", "cheesecake"}
VEG_CATS = {"vegetarian", "vegan"}
CAT_PROTEIN = {"chicken": "chicken", "seafood": "fish", "fish": "fish", "beef": "beef", "pork": "pork",
               "lamb": "lamb"}

ENTREE_TITLE = re.compile(r"\b(pasta|noodles?|noods|ramen|udon|soba|spaghetti|rigatoni|linguine|lasagna|"
                          r"orecchiette|bucatini|paccheri|shells|fregola|orzo|gnocchi|risotto|curry|stew|"
                          r"chili|soup|pozole|tacos?|tostadas?|burritos?|enchiladas?|quesadillas?|bowls?|"
                          r"stir[- ]fry|fried rice|pizza|pot ?pie|sandos?|sandwich(es)?|burgers?|"
                          r"frittata|casserole|skewers?|kebabs?|dumplings?|mujadara)\b", re.I)
SIDE_TITLE = re.compile(r"\b(salad|slaw|potatoes|fries|rice|beans|greens|veggies|vegetables)\b", re.I)
# Condiments and seasonings, when they are the whole recipe ("BBQ Sauce", not "... with BBQ Sauce").
CONDIMENT_TITLE = re.compile(r"\b(sauce|dressing|vinaigrette|aioli|mayo|dip|rub|seasoning|spice blend|"
                             r"jam|pickles?|butter)\W*$", re.I)
SWEET_TITLE = re.compile(r"\b(cookies?|cakes?|brownies?|muffins?|scones?|pie|tart|pudding|ice cream|"
                         r"granola|pancakes?|waffles?|smoothie|cocktail|spritz|margarita|syrup|"
                         r"crackers?|bread|biscuits?|focaccia|toast|cobbler|crisp|trifle)\b", re.I)


def word_re(words):
    return re.compile(r"\b(" + "|".join(words) + r")\b", re.I)


PROTEIN_RES = [(name, word_re(words)) for name, words in PROTEIN_WORDS]


def protein_in(text):
    text = NOT_A_PROTEIN.sub("", text)
    for name, rx in PROTEIN_RES:
        if rx.search(text):
            return name
    return None


def classify_protein(title, categories, ingredients):
    cats = [c.lower() for c in categories]
    if set(cats) & VEG_CATS:
        return "vegetarian"
    for c in cats:
        if c in CAT_PROTEIN:
            return CAT_PROTEIN[c]
    found = protein_in(title)
    if found:
        return found
    for name, rx in TITLE_ONLY_PROTEIN:
        if rx.search(title):
            return name
    for line in ingredients:
        found = protein_in(line)
        if found:
            return found
    if re.search(r"\b(tofu|tempeh|seitan)\b", title, re.I):
        return "vegetarian"
    # No meat or fish anywhere (chicken stock and fish sauce included) means meatless.
    if not any(NOT_VEGETARIAN.search(line) for line in ingredients):
        return "vegetarian"
    return None


def classify_course(title, categories, protein, has_steps):
    cats = {c.lower() for c in categories}
    if cats & OTHER_CATS and not cats & ENTREE_CATS:
        return "other"
    if cats & ENTREE_CATS:
        return "entree"
    if not has_steps:
        return "other"
    if CONDIMENT_TITLE.search(title) and " with " not in title.lower():
        return "other"
    if ENTREE_TITLE.search(title):
        return "entree"
    if protein and protein != "vegetarian":
        return "entree"
    if SWEET_TITLE.search(title):
        return "other"
    if cats & SIDE_CATS or SIDE_TITLE.search(title):
        return "side"
    return "other"


def parse_minutes(text):
    """'1 hour 30 minutes' -> 90, '45 min' -> 45, '30' -> 30, '60-70 minutes' -> 70."""
    if not text:
        return None
    t = text.lower()
    hours = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b", t)
    mins = re.search(r"(\d+)(?:\s*-\s*(\d+))?\s*(?:m|min|mins|minute|minutes)\b", t)
    if hours or mins:
        total = float(hours.group(1)) * 60 if hours else 0
        if mins:
            total += int(mins.group(2) or mins.group(1))
        return int(round(total)) or None
    bare = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", t)
    if bare:
        return int(bare.group(2) or bare.group(1)) or None
    return None


def total_minutes(r):
    total = parse_minutes(r.get("total_time"))
    if total:
        return total
    parts = [parse_minutes(r.get("prep_time")), parse_minutes(r.get("cook_time"))]
    return sum(p for p in parts if p) or None


def parse_serves(text):
    match = re.search(r"\d+", text or "")
    return int(match.group()) if match else None


def lines(text):
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


def steps_of(directions):
    return [re.sub(r"^(?:step\s*)?\d+\s*[.):]\s*", "", ln, flags=re.I) for ln in lines(directions)]


def dedupe(items):
    seen, out = set(), []
    for i in items:
        k = i.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(i.strip())
    return out


def to_row(r):
    title = (r.get("name") or "").strip().rstrip(".")
    categories = dedupe(r.get("categories") or [])
    ingredients = lines(r.get("ingredients"))
    steps = steps_of(r.get("directions"))
    protein = classify_protein(title, categories, ingredients)
    return {
        "source": "paprika",
        "source_uid": r["uid"],
        "title": title or "Untitled recipe",
        "url": (r.get("source_url") or "").strip() or None,
        "description": (r.get("description") or "").strip() or None,
        "credit": (r.get("source") or "").strip() or None,
        "tags": categories,
        "course": classify_course(title, categories, protein, bool(steps)),
        "protein": protein,
        # Paprika uses 0 for "not rated".
        "rating": r.get("rating") or None,
        "rating_count": None,
        "serves": parse_serves(r.get("servings")),
        "time_minutes": total_minutes(r),
        "oven": "",
        "ingredients": ingredients,
        "steps": steps,
        "tip": (r.get("notes") or "").strip(),
    }


def read_export(path):
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            yield json.loads(gzip.decompress(z.read(name)))


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python tools/import_paprika.py <export.paprikarecipes> [output-path]")
        sys.exit(1)

    rows = sorted((to_row(r) for r in read_export(sys.argv[1])), key=lambda x: x["title"].lower())
    out = ROOT / (sys.argv[2] if len(sys.argv) == 3 else ".paprika-staging.json")
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    by_course = {}
    for row in rows:
        by_course[row["course"]] = by_course.get(row["course"], 0) + 1
    print(f"Wrote {len(rows)} recipes to {out} ({', '.join(f'{v} {k}' for k, v in sorted(by_course.items()))})")


if __name__ == "__main__":
    main()
