import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchJson, selectFlyer, validateFlyerDetail, normalizeItem, dedupe,
  buildAdDoc, shouldReplace, isExpired, classifyProtein, refineCoupons
} from "../scripts/lib/flipp.mjs";

const flyer = (over = {}) => ({
  id: 1, merchant: "Tom Thumb", merchant_id: 2381, name: "Weekly Ad",
  valid_from: "2026-10-14T00:00:00-04:00", valid_to: "2026-10-20T23:59:59-04:00", ...over
});
const NOW = new Date("2026-10-15T12:00:00Z");

test("selectFlyer picks Tom Thumb, not Albertsons", () => {
  const payload = { flyers: [flyer({ id: 9, merchant: "Albertsons", merchant_id: 5661 }), flyer({ id: 2, merchant: "Tom Thumb " })] };
  assert.equal(selectFlyer(payload, { now: NOW }).id, 2);
});

test("selectFlyer rejects bad shape, missing, and expired", () => {
  assert.throws(() => selectFlyer({}, { now: NOW }), /shape/);
  assert.throws(() => selectFlyer({ flyers: [] }, { now: NOW }), /No Tom Thumb/);
  assert.throws(() => selectFlyer({ flyers: [flyer()] }, { now: new Date("2026-11-01T00:00:00Z") }), /expired/);
});

test("selectFlyer accepts upcoming flyer within 3 days only", () => {
  const f = { flyers: [flyer()] };
  assert.equal(selectFlyer(f, { now: new Date("2026-10-12T12:00:00Z") }).id, 1);
  assert.throws(() => selectFlyer(f, { now: new Date("2026-10-01T00:00:00Z") }), /expired|future/);
});

test("validateFlyerDetail rejects malformed or tiny payloads", () => {
  assert.throws(() => validateFlyerDetail({}), /shape/);
  assert.throws(() => validateFlyerDetail({ items: [{}] }), /incomplete/);
  assert.equal(validateFlyerDetail({ items: Array(25).fill({}) }).length, 25);
});

test("normalizeItem formats weight, multibuy and terms", () => {
  const n = normalizeItem({ id: 1, name: "Key Limes", price: "1.0" }, { current_price: 1.0, pre_price_text: "10 for", price_text: "member price" });
  assert.equal(n.deal, "Key Limes — 10 for $1 member price");
  const w = normalizeItem({ id: 2, name: "Red Grapes", price: "0.97" }, { current_price: 0.97, price_text: "lb member price", disclaimer_text: "Limit 5 lbs." });
  assert.equal(w.deal, "Red Grapes — 97¢ lb member price — Limit 5 lbs.");
});

test("normalizeItem handles missing price and empty items", () => {
  assert.equal(normalizeItem({ id: 3, name: "", price: "" }), null);
  assert.equal(normalizeItem({ id: 4, name: "Pay for fuel", price: "" }), null);
  const bogo = normalizeItem({ id: 5, name: "Soda", price: "" }, { sale_story: "BUY 3 GET 3 FREE" });
  assert.equal(bogo.price, null);
  assert.match(bogo.deal, /BUY 3 GET 3 FREE/);
});

test("dedupe removes identical offers", () => {
  const a = normalizeItem({ id: 1, name: "Eggs", price: "1.79" });
  const b = normalizeItem({ id: 2, name: "eggs", price: "1.79" });
  assert.equal(dedupe([a, b]).length, 1);
});

test("classifyProtein", () => {
  assert.equal(classifyProtein("USDA Choice Beef Short Ribs"), "beef");
  assert.equal(classifyProtein("Fresh Pork Butt Roast"), "pork");
  assert.equal(classifyProtein("Extra Large Raw Shrimp"), "fish");
  assert.equal(classifyProtein("Doritos"), null);
});

test("buildAdDoc matches ads/current contract with provenance", () => {
  const offers = [normalizeItem({ id: 1, name: "Boneless Skinless Chicken Breasts", price: "1.99" }), normalizeItem({ id: 2, name: "Chips", price: "2.49" })];
  const doc = buildAdDoc({ flyer: flyer(), offers, zip: "75214", fetchedAt: "t" });
  assert.equal(doc.ok, true);
  assert.equal(doc.source, "flipp");
  assert.equal(doc.flyerId, 1);
  assert.deepEqual(doc.proteinDeals.map((p) => p.protein), ["chicken"]);
  assert.equal(doc.deals.length, 2);
  assert.ok(Array.isArray(doc.coupons));
  assert.throws(() => buildAdDoc({ flyer: flyer(), offers: [], zip: "x" }), /No priced/);
});

test("shouldReplace never overwrites a newer flyer; isExpired", () => {
  const next = { validFrom: "2026-10-14T00:00:00-04:00" };
  assert.equal(shouldReplace({ ok: true, source: "flipp", validFrom: "2026-10-21T00:00:00-04:00" }, next), false);
  assert.equal(shouldReplace({ ok: true, source: "flipp", validFrom: "2026-10-07T00:00:00-04:00" }, next), true);
  assert.equal(shouldReplace({ ok: false }, next), true);
  assert.equal(isExpired({ validTo: "2026-10-20T23:59:59-04:00" }, NOW), false);
  assert.equal(isExpired({}, NOW), true);
});

test("refineCoupons uses Claude output, and falls back on failure", async () => {
  const doc = { coupons: ["Soda — BUY 3 GET 3 FREE"], deals: ["Chips — $2.49", "Grapes — 97¢ digital coupon"] };
  let seen;
  const ok = await refineCoupons(doc, { ask: async ({ prompt }) => { seen = prompt; return "x"; }, parse: () => ({ coupons: [" Soda buy 3 get 3 free ", "Soda buy 3 get 3 free"] }) });
  assert.deepEqual(ok.coupons, ["Soda buy 3 get 3 free"]);
  assert.match(seen, /digital coupon/);
  assert.doesNotMatch(seen, /Chips/);
  const log = () => {};
  const failed = await refineCoupons(doc, { ask: async () => { throw new Error("api"); }, parse: JSON.parse, log });
  assert.deepEqual(failed.coupons, doc.coupons);
  const bad = await refineCoupons(doc, { ask: async () => "x", parse: () => ({ coupons: "nope" }), log });
  assert.deepEqual(bad.coupons, doc.coupons);
});

test("fetchJson retries 5xx then succeeds; no retry on 404", async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ a: 1 }) });
  assert.deepEqual(await fetchJson("u", { fetchImpl: flaky, backoffMs: 1 }), { a: 1 });
  assert.equal(calls, 3);
  calls = 0;
  const nf = async () => (calls++, { ok: false, status: 404 });
  await assert.rejects(fetchJson("u", { fetchImpl: nf, backoffMs: 1 }), /HTTP 404/);
  assert.equal(calls, 1);
});

test("fetchJson gives up after bounded retries", async () => {
  let calls = 0;
  const down = async () => { calls++; throw new Error("network"); };
  await assert.rejects(fetchJson("u", { fetchImpl: down, retries: 2, backoffMs: 1 }), /network/);
  assert.equal(calls, 3);
});
