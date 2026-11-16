// Plan timing: one week at a time. The board's Settings choose which weekday
// the plan is drafted (planDay) and which weekday groceries are delivered
// (deliveryDay). The grocery list is always built the night before delivery,
// and the first cook night is always the day after delivery, so there is a
// day to put things away before cooking starts.
export const PLAN_DAYS = 7;
export const TIME_ZONE = process.env.PLAN_TIME_ZONE || "America/Chicago";

// Today's date (YYYY-MM-DD) in the household's time zone.
export function todayInZone(now = new Date(), zone = TIME_ZONE) {
  return now.toLocaleDateString("en-CA", { timeZone: zone });
}

// Weekday of a YYYY-MM-DD date, 0=Sun..6=Sat.
export const weekdayOf = (dateStr) => new Date(dateStr + "T00:00:00Z").getUTCDay();

export function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (a, b) => (new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000;

export const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function dayNameToIndex(name) {
  const i = DAY_NAMES.indexOf(String(name || "").toLowerCase());
  return i === -1 ? undefined : i;
}

// The next date strictly after fromDateStr that falls on weekday targetDow (0=Sun..6=Sat).
export function nextWeekday(fromDateStr, targetDow) {
  const diff = ((targetDow - weekdayOf(fromDateStr) + 7) % 7) || 7;
  return addDays(fromDateStr, diff);
}

// mealDates: dates of the live plan; startDate: optional board setting, used
// only while there is no plan; deliveryDow (0=Sun..6=Sat): board setting used
// only to anchor the very first plan when there is no startDate either.
// Returns the next window: pickup (delivery date), start (first cook night,
// the day after pickup), end, and whether a new draft is due. due has no
// lower bound, so a missed run is picked up next time this runs rather than
// waiting a full week; the upper bound just avoids drafting too far ahead.
export function nextPlanWindow({ today, mealDates = [], startDate = "", deliveryDow }) {
  const firstStart = startDate && startDate > today
    ? startDate
    : addDays(typeof deliveryDow === "number" ? nextWeekday(today, deliveryDow) : today, 1);
  const planEnd = mealDates.length ? [...mealDates].sort().slice(-1)[0] : addDays(firstStart, -1);
  const start = addDays(planEnd, 1);
  const end = addDays(start, PLAN_DAYS - 1);
  const pickup = addDays(start, -1);
  const daysUntilStart = dayDiff(start, today);
  return { start, end, pickup, due: daysUntilStart <= 6 };
}

// Cook every other night with leftovers between, flexible on the last night.
// Described in terms of the actual plan's weekdays, since those now depend on settings.
export function describeRhythm(start) {
  const weekdayName = (dateStr) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(dateStr + "T00:00:00Z"));
  const cook = [0, 2, 4].map((o) => weekdayName(addDays(start, o)));
  const leftovers = [1, 3, 5].map((o) => weekdayName(addDays(start, o)));
  return `cook ${cook.join("/")}, leftovers ${leftovers.join("/")}, flexible ${weekdayName(addDays(start, 6))}`;
}

// Claude sometimes returns extra or misdated rows; keep only the planned week.
export function meetsWindow(meals, start, end) {
  return (meals || []).filter((m) => m && typeof m.date === "string" && m.date >= start && m.date <= end);
}

// The grocery list runs at ~11:45 PM Chicago time, the night before delivery.
// Cron is UTC-only, so two schedules cover CDT and CST; only the one landing
// in the 11 PM hour (or just after, if GitHub delayed it) should build the list.
export function scheduledWindowOpen(now = new Date(), zone = TIME_ZONE) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now));
  return hour === 23 || hour === 0;
}