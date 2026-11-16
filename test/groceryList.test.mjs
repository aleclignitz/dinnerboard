import test from "node:test";
import assert from "node:assert/strict";
import { formatOrderText } from "../scripts/lib/groceryList.mjs";
import { resolveSettings } from "../scripts/lib/settings.mjs";

const settings = resolveSettings({ storeName: "Tom Thumb", substitutionRules: "Store brand is fine." }, {});

test("order text lists every section and the coupons from a good ad", () => {
  const text = formatOrderText({
    ingredients: ["2 lb chicken thighs"],
    grocery: [{ id: "g1", text: "coffee" }],
    lowStaples: [{ id: "s1", name: "Rice" }],
    settings,
    ad: { ok: true, coupons: ["$10 off $75"] },
    pickup: "2026-11-19"
  });
  assert.equal(text, [
    "Please build a Tom Thumb order for 2026-11-19, for delivery, with these items:",
    "", "Recipe ingredients:", "- 2 lb chicken thighs",
    "", "Quick adds:", "- coffee",
    "", "Staples running low:", "- Rice",
    "", "Coupons to clip (Tom Thumb weekly ad):", "- $10 off $75",
    "", "Store brand is fine. Leave the order for me to review before it's placed."
  ].join("\n"));
});

test("order text omits empty sections, notes a missing ad, and uses the pickup window", () => {
  const pickupSettings = { ...settings, orderMethod: "pickup", pickupWindow: "1-4 PM" };
  const text = formatOrderText({ ingredients: [], settings: pickupSettings, ad: { ok: false } });
  assert.match(text, /^Please build a Tom Thumb order, with an afternoon pickup \(1-4 PM if available\), with these items:/);
  assert.doesNotMatch(text, /Quick adds|Staples running low|Coupons/);
  assert.match(text, /ad could not be retrieved/);
});
