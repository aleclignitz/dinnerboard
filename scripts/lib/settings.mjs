// Non-secret settings editable from the board's Settings tab (Supabase doc
// `settings/app`). Precedence: saved board value > environment variable >
// built-in default. Secrets (API keys, browser session) never live here.
import { getDoc } from "./supabaseClient.mjs";

export const SETTINGS_DOC = "settings/app";

export const SETTING_DEFS = {
  startDate: { env: null, default: "" },
  planGuidelines: { env: "PLAN_GUIDELINES", default: "" },
  maxCookMinutes: { env: "PLAN_MAX_COOK_MINUTES", default: 45, number: true },
  storeName: { env: "STORE_NAME", default: "Grocery store pickup" },
  orderMethod: { env: "ORDER_METHOD", default: "delivery", oneOf: ["delivery", "pickup"] },
  pickupWindow: { env: "PICKUP_WINDOW", default: "1-4 PM" },
  substitutionRules: { env: "SUBSTITUTION_RULES", default: "Store-brand substitutions are fine." },
  zip: { env: "TOM_THUMB_ZIP", default: "75214" },
  storeAddress: { env: "TOM_THUMB_STORE_ADDRESS", default: "6333 E Mockingbird Ln" }
};

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

export function resolveSettings(stored = {}, env = process.env) {
  const out = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    let value = [stored?.[key], def.env ? env[def.env] : undefined].find((v) => !blank(v));
    if (blank(value)) value = def.default;
    if (def.number) {
      const n = Number(value);
      value = Number.isFinite(n) && n > 0 ? n : def.default;
    } else {
      value = String(value).trim();
    }
    if (def.oneOf) {
      value = value.toLowerCase();
      if (!def.oneOf.includes(value)) value = def.default;
    }
    out[key] = value;
  }
  if (out.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.startDate)) out.startDate = "";
  return out;
}

export async function loadSettings(supabase, env = process.env) {
  return resolveSettings((await getDoc(supabase, SETTINGS_DOC)) || {}, env);
}
