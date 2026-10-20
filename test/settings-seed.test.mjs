import test from "node:test";
import assert from "node:assert/strict";
import { resolveSettings } from "../scripts/lib/settings.mjs";
import { proteinPlan, chunk, validateRecipe, toRow, dedupeNew, buildSeedPrompt, PROTEINS } from "../scripts/lib/seedRecipes.mjs";

test("settings: board value beats env, env beats default", () => {
  const s = resolveSettings({ zip: "75201", storeName: "  " }, { TOM_THUMB_ZIP: "11111", STORE_NAME: "Kroger" });
  assert.equal(s.zip, "75201");
  assert.equal(s.storeName, "Kroger");
  assert.equal(s.pickupWindow, "1-4 PM");
});

test("settings: numbers, order method and start date are sanitized", () => {
  const s = resolveSettings({ maxCookMinutes: "abc", orderMethod: "Teleport", startDate: "next week" }, {});
  assert.equal(s.maxCookMinutes, 45);
  assert.equal(s.orderMethod, "delivery");
  assert.equal(s.startDate, "");
  const ok = resolveSettings({ maxCookMinutes: "30", orderMethod: "PICKUP", startDate: "2026-11-01" }, {});
  assert.deepEqual([ok.maxCookMinutes, ok.orderMethod, ok.startDate], [30, "pickup", "2026-11-01"]);
});

const good = { title: " Lemon Chicken ", protein: "chicken", serves: 4, time_minutes: 30, ingredients: ["a", "b", "c"], steps: ["one", "two"] };

test("seed: protein plan covers the requested count and known proteins", () => {
  const p = proteinPlan(14);
  assert.equal(p.length, 14);
  assert.ok(p.every((x) => PROTEINS.includes(x)));
  assert.deepEqual(chunk(p, 5).map((c) => c.length), [5, 5, 4]);
});

test("seed: validateRecipe accepts good and rejects bad recipes", () => {
  assert.equal(validateRecipe(good, { maxCookMinutes: 45 }).title, "Lemon Chicken");
  assert.equal(validateRecipe({ ...good, time_minutes: 90 }, { maxCookMinutes: 45 }), null);
  assert.equal(validateRecipe({ ...good, protein: "unicorn" }), null);
  assert.equal(validateRecipe({ ...good, ingredients: ["a"] }), null);
  assert.equal(validateRecipe({ ...good, steps: [] }), null);
  assert.equal(validateRecipe(null), null);
});

test("seed: rows match the picker's filters and titles are deduped", () => {
  const row = toRow(validateRecipe(good), 1000000001);
  assert.equal(row.course, "entree");
  assert.ok(row.rating >= 4);
  assert.equal(row.id, 1000000001);
  const r2 = validateRecipe({ ...good, title: "lemon chicken" });
  assert.equal(dedupeNew([validateRecipe(good), r2]).length, 1);
  assert.equal(dedupeNew([validateRecipe(good)], ["LEMON CHICKEN"]).length, 0);
});

test("seed: prompt carries proteins, guidelines and time cap", () => {
  const p = buildSeedPrompt({ proteins: ["beef"], guidelines: "no dairy", maxCookMinutes: 30, avoidTitles: ["X"] });
  assert.match(p, /beef/);
  assert.match(p, /no dairy/);
  assert.match(p, /30 minutes/);
});
