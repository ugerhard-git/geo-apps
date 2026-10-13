/**
 * Export treemaps — the OEC (Observatory of Economic Complexity) API: the
 * country list and one country's exports by product.
 *
 * The API token is optional; when given it travels in the query string, so
 * requests carry no cookies or referrer and are never cached.
 */

import { API, FALLBACK_COUNTRIES, MAX_ROWS } from "./config.js";

/** No cookies, no referrer (the token sits in the query string), no caching. */
const FETCH_OPTS = /** @type {RequestInit} */ ({
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  mode: "cors",
});

/**
 * @typedef {object} Product
 * @property {string} name
 * @property {number} section HS section 1–21, or 0 when unknown
 * @property {number} value trade value in US$
 */

/**
 * Keep foreign strings short before they are shown anywhere.
 *
 * @param {unknown} v
 * @param {number} n
 * @returns {string}
 */
export const clip = (v, n) => String(v ?? "").slice(0, n);

/**
 * BACI ships one dataset per HS revision; pick the one covering the year.
 *
 * @param {number} y
 * @returns {string}
 */
export function cubeFor(y) {
  if (y >= 2022) return "trade_i_baci_a_22";
  if (y >= 2017) return "trade_i_baci_a_17";
  if (y >= 2012) return "trade_i_baci_a_12";
  if (y >= 2007) return "trade_i_baci_a_07";
  if (y >= 2002) return "trade_i_baci_a_02";
  if (y >= 1996) return "trade_i_baci_a_96";
  return "trade_i_baci_a_92";
}

/** @param {string} token */
const tokenParam = (token) => (token ? "&token=" + encodeURIComponent(token) : "");

/**
 * The query URL for one country's exports in one year.
 *
 * @param {string} countryId OEC id, e.g. "eudeu"
 * @param {number} year
 * @param {string} token "" for none
 * @returns {string}
 */
export function dataUrl(countryId, year, token) {
  return (
    API +
    "/data.jsonrecords" +
    "?cube=" +
    cubeFor(year) +
    "&drilldowns=HS4,Year,Exporter+Country" +
    "&measures=Trade+Value" +
    "&include=Exporter+Country:" +
    encodeURIComponent(countryId) +
    ";Year:" +
    year +
    "&limit=6000,0" +
    tokenParam(token)
  );
}

/** @returns {Array<{id: string, name: string}>} */
export function parseFallback() {
  return FALLBACK_COUNTRIES.split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(" ");
      return { id: s.slice(0, i), name: s.slice(i + 1) };
    });
}

/**
 * The exporting countries the OEC knows for a year, or the built-in list when
 * the live one can't be fetched.
 *
 * @param {number} year
 * @param {string} token
 * @returns {Promise<{list: Array<{id: unknown, name: unknown}>, note: string}>}
 */
export async function loadCountryList(year, token) {
  const url =
    API +
    "/members.jsonrecords?cube=" +
    cubeFor(year) +
    "&level=Exporter+Country" +
    tokenParam(token);
  try {
    const r = await fetch(url, FETCH_OPTS);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const raw = j.data || j.members || j.values || [];
    const list = raw
      .map((/** @type {any} */ m) => ({
        id: m.ID ?? m.id ?? m.key ?? m.Key,
        name: m.Label ?? m.label ?? m.name ?? m.caption ?? m.Name,
      }))
      .filter((/** @type {any} */ c) => c.id && c.name);
    if (!list.length) throw new Error("empty");
    return { list, note: list.length + " countries, live from the OEC." };
  } catch {
    return { list: parseFallback(), note: "Built-in list — the live one didn't load." };
  }
}

/**
 * Which columns of a response row hold the product id, name and value. The
 * API has renamed them before, so they are found by pattern.
 *
 * @param {Record<string, unknown>} row
 */
function fieldsOf(row) {
  const k = Object.keys(row);
  /** @param {RegExp} re */
  const find = (re) => k.find((x) => re.test(x));
  return {
    id: find(/^hs4 id$/i) || find(/hs4.*id/i) || find(/product.*id/i),
    name: find(/^hs4$/i) || find(/^product$/i) || find(/hs4/i),
    val: find(/trade value/i) || find(/value/i),
  };
}

/**
 * Turn a data response (from the API or pasted by hand) into products.
 *
 * @param {any} json
 * @returns {Product[]}
 */
export function toProducts(json) {
  let rows = Array.isArray(json) ? json : json && (json.data || json.records);
  if (!Array.isArray(rows) || !rows.length) return [];
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
  const f = fieldsOf(rows[0]);
  if (!f.val) return [];
  const val = f.val;
  return rows
    .map((r) => {
      const rawId = String((f.id && r[f.id]) ?? "");
      /* OEC product ids are the section number glued onto the 4-digit HS code,
       so everything before the last four digits is the section. */
      let sec = parseInt(rawId.slice(0, Math.max(0, rawId.length - 4)), 10);
      if (!(sec >= 1 && sec <= 21)) sec = 0;
      return {
        name: clip((f.name && r[f.name]) ?? rawId, 120),
        section: sec,
        value: Number(r[val]) || 0,
      };
    })
    .filter((p) => p.value > 0);
}

/**
 * One country's exports in one year.
 *
 * @param {string} countryId
 * @param {number} year
 * @param {string} token
 * @returns {Promise<Product[]>}
 */
export async function fetchYear(countryId, year, token) {
  const r = await fetch(dataUrl(countryId, year, token), FETCH_OPTS);
  if (!r.ok) throw new Error("The OEC returned " + r.status + " for " + year + ".");
  return toProducts(await r.json());
}
