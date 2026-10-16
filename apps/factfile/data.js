/**
 * Fact file — reading and checking the data files.
 *
 * The files are built by scripts/factfile/build-data.mjs and served from
 * this site, but they are still checked field by field: a malformed file
 * then shows less, never something broken.
 */

import { MAX_FILE_BYTES } from "./config.js";

/**
 * @typedef {object} Index
 * @property {Set<string>} codes the countries there is a file for
 * @property {Set<string>} others every country's name and adjective, lower case
 */

/**
 * @typedef {object} CountryRecord
 * @property {string} code
 * @property {string[]} names every known name to black out
 * @property {Record<string, any>} fields
 */

/** @param {unknown} v @param {number} max */
const str = (v, max) =>
  typeof v === "string" && v.length <= max ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ") : "";
/** @param {unknown} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** @param {unknown} v @param {number} max @param {number} each */
const strs = (v, max, each) =>
  Array.isArray(v)
    ? v
        .slice(0, max)
        .map((s) => str(s, each))
        .filter(Boolean)
    : [];

/**
 * Fetch a file of ours as JSON, refusing anything oversized.
 *
 * @param {string} url
 */
async function getFile(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const text = await r.text();
  if (text.length > MAX_FILE_BYTES) throw new Error("the data file is too large");
  return JSON.parse(text);
}

/**
 * @param {any} json
 * @returns {Index}
 */
export function parseIndex(json) {
  const codes = new Set(Object.keys(json?.countries || {}).filter((c) => /^[A-Z]{2}$/.test(c)));
  if (codes.size < 100) throw new Error("the list of countries is incomplete");
  const others = new Set(strs(json.known, 2000, 80).map((s) => s.toLowerCase()));
  return { codes, others };
}

/** Text fields, and how long each may be. */
const TEXTS = {
  climate: 300,
  terrain: 300,
  hazards: 400,
  resources: 300,
  farm: 300,
  exports: 300,
  industries: 300,
  languages: 300,
  religions: 300,
  regions: 300,
  legal: 300,
  suffrage: 200,
  military: 300,
  colours: 120,
};

/**
 * Check a country's file, keeping only what is well-formed.
 *
 * @param {any} json
 * @param {string} code the country asked for
 * @returns {CountryRecord}
 */
export function parseRecord(json, code) {
  if (!json || json.code !== code) throw new Error("the data file is for another country");
  const n = json.names || {};
  const names = ["country", "people", "places", "neighbours"].flatMap((k) => strs(n[k], 400, 120));
  const f = json.fields || {};
  /** @type {Record<string, any>} */
  const fields = {};
  for (const [k, max] of Object.entries(TEXTS)) {
    const t = str(f[k], max);
    if (t) fields[k] = t;
  }
  const h = f.heights;
  if (h && (num(h.high) !== null || num(h.low) !== null || num(h.mean) !== null))
    fields.heights = { high: num(h.high), low: num(h.low), mean: num(h.mean) };
  if (num(f.coast) !== null) fields.coast = num(f.coast);
  if (f.borders && num(f.borders.total) !== null)
    fields.borders = {
      total: num(f.borders.total),
      lengths: (Array.isArray(f.borders.lengths) ? f.borders.lengths : [])
        .map(num)
        .filter((x) => x !== null && x > 0)
        .slice(0, 20),
    };
  if (num(f.area) !== null) fields.area = num(f.area);
  if (f.lake && num(f.lake.sqkm) !== null)
    fields.lake = { sqkm: num(f.lake.sqkm), kind: str(f.lake.kind, 20) };
  if (f.river && num(f.river.km) !== null)
    fields.river = { km: num(f.river.km), shared: num(f.river.shared) || 0 };
  if (f.city && num(f.city.millions) !== null)
    fields.city = { millions: num(f.city.millions), capital: f.city.capital === true };
  if (f.age && (num(f.age.median) !== null || num(f.age.life) !== null))
    fields.age = { median: num(f.age.median), life: num(f.age.life) };
  if (f.system && str(f.system.text, 200))
    fields.system = { text: str(f.system.text, 200), unsettled: f.system.unsettled === true };
  if (f.parliament && (num(f.parliament.chambers) || Array.isArray(f.parliament.seats)))
    fields.parliament = {
      chambers: num(f.parliament.chambers) || 0,
      seats: (Array.isArray(f.parliament.seats) ? f.parliament.seats : [])
        .slice(0, 2)
        .map((/** @type {any} */ c) => ({
          seats: num(c?.seats),
          how: str(c?.how, 80),
          term: str(c?.term, 40),
        }))
        .filter((c) => c.seats !== null),
    };
  if (f.independence && str(f.independence.date, 60))
    fields.independence = {
      date: str(f.independence.date, 60),
      event: str(f.independence.event, 120),
      from: str(f.independence.from, 80),
    };
  if (f.holiday && str(f.holiday.date, 40))
    fields.holiday = { name: str(f.holiday.name, 120), date: str(f.holiday.date, 40) };
  const orgs = strs(f.memberships, 40, 40);
  if (orgs.length) fields.memberships = orgs;
  return { code, names, fields };
}

/** @returns {Promise<Index>} */
export const loadIndex = async () => parseIndex(await getFile("data/index.json"));

/**
 * @param {string} code ISO alpha-2
 * @returns {Promise<CountryRecord>}
 */
export async function loadRecord(code) {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("not a country code");
  return parseRecord(await getFile(`data/${code}.json`), code);
}
