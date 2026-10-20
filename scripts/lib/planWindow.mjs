// Plan timing: one week at a time, Thursday dinner through the following
// Wednesday. The Tom Thumb ad publishes early Wednesday, so the Wednesday run
// plans the week that starts the next day.
export const PLAN_DAYS = 7;

export function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (a, b) => (new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000;

// mealDates: dates of the live plan; startDate: optional board setting, used
// only while there is no plan. Returns the next window and whether it is due:
// from the day before it starts, with 2 days of grace if a run was missed.
export function nextPlanWindow({ today, mealDates = [], startDate = "" }) {
  const firstStart = startDate && startDate > today ? startDate : addDays(today, 1);
  const planEnd = mealDates.length ? [...mealDates].sort().slice(-1)[0] : addDays(firstStart, -1);
  const start = addDays(planEnd, 1);
  const end = addDays(start, PLAN_DAYS - 1);
  const daysUntilStart = dayDiff(start, today);
  return { start, end, pickup: start, due: daysUntilStart <= 1 && daysUntilStart >= -2 };
}

// Cook Thu/Sat/Mon with leftovers the next day; Wednesday (shopping day) is flexible.
export const RHYTHM = "cook Thu/Sat/Mon, leftovers Fri/Sun/Tue, flexible Wednesday";

// Claude sometimes returns extra or misdated rows; keep only the planned week.
export function meetsWindow(meals, start, end) {
  return (meals || []).filter((m) => m && typeof m.date === "string" && m.date >= start && m.date <= end);
}

// The grocery list runs at ~11:45 PM Chicago time. Cron is UTC-only, so two
// schedules cover CDT and CST; only the one landing in the 11 PM hour (or
// just after, if GitHub delayed it) should build the list.
export function scheduledWindowOpen(now = new Date(), zone = "America/Chicago") {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now));
  return hour === 23 || hour === 0;
}