import test from "node:test";
import assert from "node:assert/strict";
import { nextPlanWindow, addDays, meetsWindow, scheduledWindowOpen, PLAN_DAYS } from "../scripts/lib/planWindow.mjs";

// 2026-10-21 is a Wednesday; the week runs Thu 10-22 through Wed 10-28.
const week = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

test("plan window: Wednesday run drafts Thursday..Wednesday", () => {
  const w = nextPlanWindow({ today: "2026-10-21", mealDates: week("2026-10-15") });
  assert.deepEqual([w.start, w.end, w.pickup, w.due], ["2026-10-22", "2026-10-28", "2026-10-22", true]);
  assert.equal(addDays(w.end, 0), "2026-10-28");
  assert.equal(PLAN_DAYS, 7);
});

test("plan window: Thursday run after promotion is not due", () => {
  const w = nextPlanWindow({ today: "2026-10-22", mealDates: week("2026-10-22") });
  assert.equal(w.start, "2026-10-29");
  assert.equal(w.due, false);
});

test("plan window: a missed Wednesday still drafts through Friday, then stops", () => {
  const dates = week("2026-10-15");
  assert.equal(nextPlanWindow({ today: "2026-10-23", mealDates: dates }).due, true);
  assert.equal(nextPlanWindow({ today: "2026-10-26", mealDates: dates }).due, false);
});

test("plan window: first plan uses a future start date, else tomorrow", () => {
  const later = nextPlanWindow({ today: "2026-10-19", startDate: "2026-10-22" });
  assert.deepEqual([later.start, later.end, later.due], ["2026-10-22", "2026-10-28", false]);
  assert.equal(nextPlanWindow({ today: "2026-10-21", startDate: "2026-10-22" }).due, true);
  assert.equal(nextPlanWindow({ today: "2026-10-21", startDate: "2026-01-01" }).start, "2026-10-22");
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