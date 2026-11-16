import test from "node:test";
import assert from "node:assert/strict";
import { nextPlanWindow, addDays, meetsWindow, nextWeekday, dayNameToIndex, describeRhythm, scheduledWindowOpen, PLAN_DAYS } from "../scripts/lib/planWindow.mjs";

const week = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

test("plan window: cadence is locked once a plan exists, pickup is the day before start", () => {
  const w = nextPlanWindow({ today: "2026-10-21", mealDates: week("2026-10-15") });
  assert.deepEqual([w.start, w.end, w.pickup, w.due], ["2026-10-22", "2026-10-28", "2026-10-21", true]);
  assert.equal(addDays(w.end, 0), "2026-10-28");
  assert.equal(PLAN_DAYS, 7);
});

test("plan window: due has no lower bound, so a missed run is still picked up later", () => {
  const dates = week("2026-10-15");
  assert.equal(nextPlanWindow({ today: "2026-10-22", mealDates: dates }).due, true);
  assert.equal(nextPlanWindow({ today: "2026-11-01", mealDates: dates }).due, true);
});

test("plan window: due is false more than 6 days before the next start", () => {
  const dates = week("2026-10-15");
  assert.equal(nextPlanWindow({ today: "2026-10-14", mealDates: dates }).due, false);
});

test("plan window: first plan uses a future start date, else the next delivery day + 1", () => {
  const later = nextPlanWindow({ today: "2026-10-15", startDate: "2026-10-22" });
  assert.deepEqual([later.start, later.end, later.due], ["2026-10-22", "2026-10-28", false]);
  assert.equal(nextPlanWindow({ today: "2026-10-21", startDate: "2026-10-22" }).due, true);
  // No startDate: anchor to the next occurrence of deliveryDow, then +1 for the first cook night.
  // 2026-10-21 is Wednesday (3); next Saturday (6) is 2026-10-24, so start is 2026-10-25, pickup 2026-10-24.
  const w = nextPlanWindow({ today: "2026-10-21", deliveryDow: 6 });
  assert.deepEqual([w.pickup, w.start], ["2026-10-24", "2026-10-25"]);
});

test("nextWeekday finds the next occurrence of a weekday strictly after a date", () => {
  assert.equal(nextWeekday("2026-10-21", 3), "2026-10-28"); // Wednesday -> next Wednesday, not today
  assert.equal(nextWeekday("2026-10-21", 5), "2026-10-23"); // Wednesday -> Friday
});

test("dayNameToIndex resolves day names case-insensitively", () => {
  assert.equal(dayNameToIndex("Friday"), 5);
  assert.equal(dayNameToIndex("saturday"), 6);
  assert.equal(dayNameToIndex("nope"), undefined);
});

test("describeRhythm reflects the actual plan start weekday", () => {
  // 2026-10-25 is a Sunday.
  assert.equal(describeRhythm("2026-10-25"), "cook Sun/Tue/Thu, leftovers Mon/Wed/Fri, flexible Sat");
});

test("meetsWindow drops meals outside the planned week", () => {
  const meals = [{ date: "2026-10-21" }, { date: "2026-10-22" }, { date: "2026-10-28" }, { date: "2026-10-29" }, { date: 5 }, null];
  assert.deepEqual(meetsWindow(meals, "2026-10-22", "2026-10-28").map((m) => m.date), ["2026-10-22", "2026-10-28"]);
});

test("scheduled grocery window: exactly one of the two UTC crons lands at ~11:45 PM Chicago", () => {
  // CDT (UTC-5): 04:45 UTC is 11:45 PM Wed; 05:45 UTC is 12:45 AM Thu (hour 0, but status check makes it a no-op).
  assert.equal(scheduledWindowOpen(new Date("2026-10-22T04:45:00Z")), true);
  // CST (UTC-6): 04:45 UTC is 10:45 PM (skip); 05:45 UTC is 11:45 PM (run).
  assert.equal(scheduledWindowOpen(new Date("2026-12-10T04:45:00Z")), false);
  assert.equal(scheduledWindowOpen(new Date("2026-12-10T05:45:00Z")), true);
  assert.equal(scheduledWindowOpen(new Date("2026-10-21T17:00:00Z")), false);
});
