// Client + normalizer for Flipp's undocumented flyer endpoints (backflipp.wishabi.com).
// Not an official API: every response is validated and failures are explicit.

const BASE = "https://backflipp.wishabi.com/flipp";
const HEADERS = { "User-Agent": "dinnerboard/1.0 (personal meal planner)", Accept: "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { retries = 3, timeoutMs = 15000, backoffMs = 1000, fetchImpl = fetch } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      // Only 429 and 5xx are transient; other 4xx will not improve on retry.
      if (res.status !== 429 && res.status < 500) throw lastErr;
    } catch (err) {
      if (err === lastErr) throw err;
      lastErr = err;
    }
    if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
  }
  throw lastErr;
}

export function selectFlyer(payload, { now = new Date(), merchantId = 2381, merchantName = "Tom Thumb", flyerName = "Weekly Ad" } = {}) {
  if (!payload || !Array.isArray(payload.flyers)) throw new Error("Unexpected flyer list shape: missing flyers[]");
  const candidates = payload.flyers.filter((f) => {
    const name = String(f.merchant || "").trim().toLowerCase();
    const idMatch = f.merchant_id === merchantId;
    return (idMatch || name === merchantName.toLowerCase()) && String(f.name || "").trim() === flyerName;
  });
  if (!candidates.length) throw new Error(`No ${merchantName} "${flyerName}" flyer found for this ZIP`);

  const t = now.getTime();
  const withDates = candidates
    .map((f) => ({ f, from: Date.parse(f.valid_from), to: Date.parse(f.valid_to) }))
    .filter((c) => Number.isFinite(c.from) && Number.isFinite(c.to));
  const current = withDates.filter((c) => c.from <= t && t <= c.to).sort((a, b) => b.from - a.from);
  if (current.length) return current[0].f;
  // Upcoming ad: Flipp publishes it a day early; accept only within 3 days of start.
  const upcoming = withDates.filter((c) => c.from > t && c.from - t <= 3 * 86400000).sort((a, b) => a.from - b.from);
  if (upcoming.length) return upcoming[0].f;
  throw new Error(`${merchantName} flyer is expired or too far in the future (refusing to use stale data)`);
}

export function validateFlyerDetail(detail) {
  if (!detail || !Array.isArray(detail.items)) throw new Error("Unexpected flyer detail shape: missing items[]");
  if (detail.items.length < 20) throw new Error(`Flyer has only ${detail.items.length} items; treating as incomplete`);
  return detail.items;
}

const PROTEIN_RULES = [
  ["chicken", /\b(chicken|wings|tenders|drums|thighs)\b/i],
  ["beef", /\b(beef|steak|steaks|sirloin|chuck|short ribs|brisket|ribeye|ground beef|meatballs)\b/i],
  ["pork", /\b(pork|bacon|ham|bratwurst|sausage|ribs)\b/i],
  ["turkey", /\bturkey\b/i],
  ["lamb", /\blamb\b/i],
  ["fish", /\b(shrimp|salmon|catfish|crab|tilapia|cod|fish|seafood)\b/i]
];

export function classifyProtein(name) {
  const hit = PROTEIN_RULES.find(([, re]) => re.test(name));
  return hit ? hit[0] : null;
}

const clean = (s) => String(s ?? "").replace(/®|™/g, "").replace(/\s+/g, " ").trim();

// Merges list item with optional per-item detail (price_text, description, limits).
export function normalizeItem(item, detail = null) {
  const name = clean(item.name);
  if (!name) return null;
  const d = detail || {};
  const price = Number.parseFloat(d.current_price ?? item.price);
  const hasPrice = Number.isFinite(price) && price > 0;
  const priceText = clean(d.price_text);
  const prefix = clean(d.pre_price_text); // e.g. "2 for", "10 for"
  const terms = [clean(d.sale_story), clean(d.description), clean(d.disclaimer_text)].filter(Boolean);
  if (!hasPrice && !terms.length && !item.discount) return null;

  let priceLabel = "";
  if (hasPrice) {
    const amt = Number.isInteger(price) ? `$${price}` : price < 1 ? `${Math.round(price * 100)}¢` : `$${price.toFixed(2)}`;
    priceLabel = [prefix, amt, priceText].filter(Boolean).join(" ");
  }
  return {
    id: item.id,
    name,
    price: hasPrice ? price : null,
    priceText: priceText || null,
    multibuy: prefix || null,
    terms: terms.join("; ") || null,
    deal: [name, priceLabel, terms.join("; ")].filter(Boolean).join(" — ")
  };
}

export function dedupe(offers) {
  const seen = new Set();
  return offers.filter((o) => {
    const key = `${o.name.toLowerCase()}|${o.price}|${o.priceText}|${o.multibuy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Produces the existing ads/current contract plus provenance fields.
export function buildAdDoc({ flyer, offers, zip, fetchedAt = new Date().toISOString() }) {
  const priced = offers.filter((o) => o.price !== null);
  if (!priced.length) throw new Error("No priced offers after normalization");
  const byProtein = new Map();
  for (const o of priced) {
    const p = classifyProtein(o.name);
    if (!p) continue;
    if (!byProtein.has(p)) byProtein.set(p, []);
    byProtein.get(p).push(o.deal);
  }
  return {
    ok: true,
    source: "flipp",
    store: "Tom Thumb",
    zip,
    flyerId: flyer.id,
    flyerName: flyer.name,
    validFrom: flyer.valid_from,
    validTo: flyer.valid_to,
    proteinDeals: [...byProtein].map(([protein, items]) => ({ protein, items })),
    deals: priced.map((o) => o.deal),
    coupons: offers.filter((o) => o.price === null && o.terms).map((o) => o.deal),
    fetchedAt
  };
}

const COUPON_HINT = /coupon|digital|clip|\$\s?\d+(\.\d+)?\s+off|\d+%\s+off|buy \d+|bogo|free/i;

// Optional Claude pass: cleans up the coupon list. Never throws; on any failure
// the keyword-based coupons already in the doc are kept.
export async function refineCoupons(doc, { ask, parse, log = console.log } = {}) {
  const candidates = [...new Set([...doc.coupons, ...doc.deals.filter((d) => COUPON_HINT.test(d))])];
  if (!candidates.length) return doc;
  const system = "You convert grocery weekly-ad offer text into structured JSON only, no prose.";
  const prompt = `Offer lines from this week's Tom Thumb weekly ad (from a structured feed):
${JSON.stringify(candidates)}

Return JSON exactly: {"coupons": ["..."]}
Include only offers that need a digital coupon clipped, cart-level or whole-order savings (e.g. "$10 off $75 purchase"), or multibuy/BOGO promotions with their conditions. Write one concise line each, keeping prices, limits and dates. Exclude ordinary sale prices. Do not invent anything not in the input.`;
  try {
    const out = parse(await ask({ system, prompt, maxTokens: 2000 }));
    if (!Array.isArray(out?.coupons) || out.coupons.some((c) => typeof c !== "string")) throw new Error("bad coupons shape");
    return { ...doc, coupons: [...new Set(out.coupons.map((c) => c.trim()).filter(Boolean))] };
  } catch (err) {
    log(`Claude coupon pass failed, keeping keyword coupons: ${err.message}`);
    return doc;
  }
}

// Decide whether the new doc may replace the existing ads/current doc.
export function shouldReplace(existing, next) {
  if (!existing || existing.ok !== true) return true;
  if (existing.source !== "flipp") return true;
  const a = Date.parse(existing.validFrom);
  const b = Date.parse(next.validFrom);
  if (Number.isFinite(a) && Number.isFinite(b) && a > b) return false;
  return true;
}

export function isExpired(doc, now = new Date()) {
  const to = Date.parse(doc?.validTo);
  return !Number.isFinite(to) || to < now.getTime();
}

export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await fn(list[idx], idx);
      }
    })
  );
  return out;
}

export async function fetchTomThumbAd({ zip, now = new Date(), enrich = true, fetchOpts = {}, log = console.log } = {}) {
  const q = `locale=en-us&postal_code=${encodeURIComponent(zip)}`;
  const list = await fetchJson(`${BASE}/flyers?${q}`, fetchOpts);
  const flyer = selectFlyer(list, { now });
  log(`Selected flyer ${flyer.id} (${flyer.valid_from} → ${flyer.valid_to})`);
  const items = validateFlyerDetail(await fetchJson(`${BASE}/flyers/${flyer.id}?${q}`, fetchOpts));

  let enrichFailures = 0;
  const details = await mapLimit(items, enrich ? 4 : 0, async (it) => {
    if (!enrich) return null;
    try {
      const r = await fetchJson(`${BASE}/items/${it.id}`, { ...fetchOpts, retries: 1 });
      await sleep(100);
      return r.item || null;
    } catch {
      enrichFailures++;
      return null;
    }
  });
  if (enrichFailures) log(`Item enrichment failed for ${enrichFailures}/${items.length} items (using list data)`);

  const offers = dedupe(items.map((it, i) => normalizeItem(it, details[i])).filter(Boolean));
  return buildAdDoc({ flyer, offers, zip, fetchedAt: now.toISOString() });
}
