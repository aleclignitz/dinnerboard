// Tuesday job: promotes a due draft into the live plan, then drafts the
// next two weeks when the pickup date is close enough. Ported from
// automation/1-plan-draft-task.md, minus the Gmail order-check step
// (STEP 1B) and the recipe-dataset lookup, both left for later.
import { getSupabase, getDoc, getCollection, setDoc, deleteDoc } from "./lib/supabaseClient.mjs";
import { askClaude } from "./lib/claude.mjs";

const TIME_ZONE = process.env.PLAN_TIME_ZONE || "America/Chicago";
const GUIDELINES = process.env.PLAN_GUIDELINES || "";

function todayInZone() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function latestSundayOnOrBefore(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

async function main() {
  const supabase = getSupabase();
  const today = todayInZone();
  const notes = [];

  // STEP 1: housekeeping - promote a due draft into the live plan
  let draftMeals = await getCollection(supabase, "draft");
  if (draftMeals.length) {
    const earliest = draftMeals.map((m) => m.date).sort()[0];
    if (earliest <= today) {
      const meals = await getCollection(supabase, "meals");
      for (const m of meals) {
        const { id, ...rest } = m;
        await setDoc(supabase, `history/${id}`, rest);
        await deleteDoc(supabase, `meals/${id}`);
      }
      for (const m of draftMeals) {
        const { id, swapOut, ...rest } = m;
        await setDoc(supabase, `meals/${id}`, rest);
        await deleteDoc(supabase, `draft/${id}`);
      }
      await deleteDoc(supabase, "plan/draft");
      const current = (await getDoc(supabase, "plan/current")) || {};
      const dates = (await getCollection(supabase, "meals")).map((m) => m.date).sort();
      await setDoc(supabase, "plan/current", {
        ...current,
        start: dates[0],
        end: dates[dates.length - 1],
        status: "active",
        pickup: "",
        statusNote: ""
      });
      notes.push("Promoted the drafted plan to active.");
    }
  }

  // STEP 2: is a draft due?
  draftMeals = await getCollection(supabase, "draft");
  if (draftMeals.length) {
    console.log("Draft already pending, nothing to do.", notes.join(" "));
    return;
  }
  const meals = await getCollection(supabase, "meals");
  const planEnd = meals.length ? meals.map((m) => m.date).sort().slice(-1)[0] : today;
  const newStart = addDays(planEnd, 1);
  const pickup = latestSundayOnOrBefore(newStart);
  const daysUntilPickup = (new Date(pickup) - new Date(today)) / 86400000;
  if (!(daysUntilPickup <= 7 && daysUntilPickup >= -2)) {
    console.log(`Next draft not due until closer to ${pickup}.`, notes.join(" "));
    return;
  }
  const newEnd = addDays(pickup, 14);

  // STEP 3: gather context
  const history = await getCollection(supabase, "history");
  const ideas = await getCollection(supabase, "ideas");
  const grocery = await getCollection(supabase, "grocery");
  const staples = await getCollection(supabase, "staples");
  const freezer = await getCollection(supabase, "freezer");
  const current = (await getDoc(supabase, "plan/current")) || {};
  const guidelines = current.guidelines || GUIDELINES;

  // STEP 4-6: ask Claude to draft the plan as JSON
  const system = "You write a two-week household dinner plan as strict JSON only, no prose, no markdown fences.";
  const prompt = `Household guidelines: ${guidelines}
Plan range: ${newStart} to ${newEnd}. Pickup day: ${pickup}.
Default rhythm: cook Mon/Wed/Fri, leftovers Tue/Thu/Sat, flexible Sunday.
Recent history with ratings (bring back 4-5 star meals at most twice, never repeat 1-2 star meals): ${JSON.stringify(history.slice(-30))}
Requests to address: ${JSON.stringify(ideas)}
Freezer on hand (use first): ${JSON.stringify(freezer)}
Staples (skip "have" items from the grocery list): ${JSON.stringify(staples)}
Quick-add groceries already requested: ${JSON.stringify(grocery)}

Write an original recipe for every cook night and any flex night with a specific dish. Week 2 meals using a protein bought at pickup need a "thaw" field describing what to move from freezer to fridge the night before. Use safe internal temperatures (poultry 165F, fish 145F).

Return JSON with exactly this shape:
{
  "meals": [{"date":"YYYY-MM-DD","kind":"cook|leftovers|flex","title":"","details":"","from":"","thaw":"","recipe":{"serves":0,"time":0,"oven":"","ingredients":[""],"steps":[""],"tip":""}}],
  "summary": "1-2 sentences: what's new and what's returning",
  "prep": "Freeze on arrival: ...",
  "groceries": [{"section":"Proteins, use fresh (week 1)","items":[""]}]
}`;

  const raw = await askClaude({ system, prompt, maxTokens: 8000 });
  const plan = JSON.parse(raw);

  // STEP 6: save the draft
  const dayStamp = newStart.replace(/-/g, "");
  for (let i = 0; i < plan.meals.length; i++) {
    const id = `p${dayStamp}-${String(i + 1).padStart(2, "0")}`;
    await setDoc(supabase, `draft/${id}`, { ...plan.meals[i], thawDone: false, rating: 0, swapOut: false });
  }
  await setDoc(supabase, "plan/draft", {
    start: newStart,
    end: newEnd,
    pickup,
    summary: plan.summary,
    prep: plan.prep,
    groceries: plan.groceries
  });
  await setDoc(supabase, "plan/current", { ...current, status: "drafted", pickup });

  console.log(`Drafted ${plan.meals.length} meals for ${newStart} to ${newEnd}. ${notes.join(" ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
