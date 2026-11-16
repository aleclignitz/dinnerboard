import test from "node:test";
import assert from "node:assert/strict";
import { buildAttempts, pickCandidates } from "../scripts/lib/recipePicker.mjs";

// Minimal in-memory stand-in for the supabase-js query builder calls the picker makes.
function fakeSupabase(rows) {
  return {
    from() {
      const filters = [];
      let limit = Infinity;
      const q = {
        select: () => q,
        eq: (col, v) => { filters.push((r) => r[col] === v); return q; },
        neq: (col, v) => { filters.push((r) => r[col] !== v); return q; },
        lte: (col, v) => { filters.push((r) => r[col] != null && r[col] <= v); return q; },
        gte: (col, v) => { filters.push((r) => r[col] != null && r[col] >= v); return q; },
        not: (col, _op, list) => { const ids = list.slice(1, -1).split(",").map(Number); filters.push((r) => !ids.includes(r[col])); return q; },
        order: () => q,
        limit: (n) => { limit = n; return q; },
        then: (resolve) => resolve({
          data: rows.filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.id - b.id)
            .slice(0, limit),
          error: null
        })
      };
      return q;
    }
  };
}

const entree = (id, source, rating, protein = "chicken") => ({ id, source, rating, protein, course: "entree", time_minutes: 30 });

test("shortlist puts up to 3 of your own unrated recipes ahead of rated NYT ones", async () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => entree(i + 1, "nyt", 4.5)),
    entree(2000000001, "paprika", null),
    entree(2000000002, "manual", null),
    entree(2000000003, "paprika", 5),
    entree(2000000004, "paprika", null),
    entree(2000000005, "paprika", null, "fish")
  ];
  const { candidates } = await pickCandidates(fakeSupabase(rows), { protein: "chicken", maxTime: 45, excludeIds: [2000000003] });
  const ids = candidates.map((c) => c.id);
  assert.equal(ids.length, 10);
  assert.deepEqual(ids.slice(0, 3), [2000000001, 2000000002, 2000000004]);
  assert.deepEqual(ids.slice(3), [1, 2, 3, 4, 5, 6, 7]);
});

test("shortlist is all NYT when you have no matching recipes of your own", async () => {
  const rows = [entree(1, "nyt", 4.8), entree(2, "nyt", 4.2), entree(2000000001, "paprika", null, "beef")];
  const { candidates } = await pickCandidates(fakeSupabase(rows), { protein: "chicken", maxTime: 45 });
  assert.deepEqual(candidates.map((c) => c.id), [1, 2]);
});

test("picker relaxes the rating floor, then the time cap, and drops the protein last", () => {
  const steps = buildAttempts({ protein: "fish", maxTime: 45 }).map((a) => `${a.protein}/${a.maxTime}/${a.minRating}`);
  assert.deepEqual(steps, [
    "fish/45/4", "fish/45/0", "fish/null/4", "fish/null/0",
    "null/45/4", "null/45/0", "null/null/4", "null/null/0"
  ]);
});

test("picker with no protein or time cap only relaxes the rating floor", () => {
  assert.deepEqual(buildAttempts({}), [
    { protein: null, maxTime: null, minRating: 4 },
    { protein: null, maxTime: null, minRating: 0 }
  ]);
});
