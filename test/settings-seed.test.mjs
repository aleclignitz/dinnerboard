import test from "node:test";
import assert from "node:assert/strict";
import { resolveSettings } from "../scripts/lib/settings.mjs";

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

