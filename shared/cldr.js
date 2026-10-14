/**
 * Country names and ISO codes from the Unicode CLDR.
 *
 * CLDR supplies the standard English name of every territory, its two-letter
 * ISO code, and alternative names ("Czechia" / "Czech Republic"), so the
 * country pickers answer to whatever people type.
 *
 * @module shared/cldr
 */

import { NPM_CDN, getJson } from "./net.js";
import { cleanText } from "./text.js";
import { own } from "./util.js";

/** The CLDR release every app reads. Bump it in one place. */
export const CLDR_VERSION = "47";

/**
 * URL of a file inside one of the CLDR npm packages.
 *
 * @param {string} pkg e.g. `"cldr-core"`
 * @param {string} path e.g. `"supplemental/territoryInfo.json"`
 * @returns {string}
 */
export const cldrUrl = (pkg, path) => `${NPM_CDN}/${pkg}@${CLDR_VERSION}/${path}`;

/** English territory names. */
export const URL_TERRITORIES = cldrUrl("cldr-localenames-full", "main/en/territories.json");

/** Two-letter CLDR codes that are groupings or placeholders, not countries. */
export const NOT_A_COUNTRY = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

/**
 * @typedef {object} Territory
 * @property {string} code ISO 3166-1 alpha-2 code, e.g. `"DE"`
 * @property {string} name standard English name, e.g. `"Germany"`
 * @property {string[]} alts alternative names (CLDR's `-alt-short`, `-alt-variant`)
 */

/**
 * Pull the territory map out of CLDR's `territories.json`.
 *
 * @param {any} data parsed `territories.json`
 * @returns {Record<string, string>}
 * @throws when the file does not have the expected shape
 */
export function territoryNames(data) {
  const t =
    data &&
    data.main &&
    data.main.en &&
    data.main.en.localeDisplayNames &&
    data.main.en.localeDisplayNames.territories;
  if (!t || typeof t !== "object") throw new Error("unexpected territories data");
  return t;
}

/**
 * Turn CLDR's `territories.json` into one record per country.
 *
 * @param {any} data parsed `territories.json`
 * @param {Set<string>} [exclude=NOT_A_COUNTRY] codes to leave out
 * @returns {Territory[]} in CLDR's order; only entries with a name
 */
export function parseTerritories(data, exclude = NOT_A_COUNTRY) {
  const t = territoryNames(data);
  /** @type {Map<string, Territory>} */
  const byCode = new Map();
  for (const key of Object.keys(t)) {
    const value = own(t, key);
    if (typeof value !== "string") continue;
    const code = key.split("-")[0];
    if (!/^[A-Z]{2}$/.test(code) || exclude.has(code)) continue;
    const entry = byCode.get(code) || { code, name: "", alts: [] };
    if (key === code) entry.name = cleanText(value, 80);
    else entry.alts.push(cleanText(value, 80)); // -alt-short, -alt-variant
    byCode.set(code, entry);
  }
  return [...byCode.values()].filter((e) => e.name);
}

/**
 * Fetch and parse the CLDR territory list.
 *
 * @param {Set<string>} [exclude=NOT_A_COUNTRY]
 * @returns {Promise<Territory[]>}
 */
export async function loadTerritories(exclude = NOT_A_COUNTRY) {
  return parseTerritories(await getJson(URL_TERRITORIES), exclude);
}

/** ISO code mappings: alpha-2 → alpha-3, numeric and FIPS. */
export const URL_CODE_MAPPINGS = cldrUrl("cldr-core", "supplemental/codeMappings.json");

/**
 * Pull the alpha-2 → alpha-3 table out of CLDR's `codeMappings.json`.
 *
 * @param {any} data parsed `codeMappings.json`
 * @returns {Map<string, string>} e.g. `"DE"` → `"DEU"`
 * @throws when the file does not have the expected shape
 */
export function parseAlpha3(data) {
  const m = data && data.supplemental && data.supplemental.codeMappings;
  if (!m || typeof m !== "object") throw new Error("unexpected code mappings data");
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const code of Object.keys(m)) {
    const a3 = own(m, code) && own(m, code)._alpha3;
    if (/^[A-Z]{2}$/.test(code) && typeof a3 === "string" && /^[A-Z]{3}$/.test(a3))
      out.set(code, a3);
  }
  return out;
}

/**
 * Fetch the alpha-2 → alpha-3 table.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function loadAlpha3() {
  return parseAlpha3(await getJson(URL_CODE_MAPPINGS));
}

/**
 * Pull the alpha-2 → ISO numeric table out of CLDR's `codeMappings.json`.
 * Numeric codes are what world-atlas uses to identify its country shapes.
 *
 * @param {any} data parsed `codeMappings.json`
 * @returns {Map<string, string>} e.g. `"DE"` → `"276"` (always three digits)
 * @throws when the file does not have the expected shape
 */
export function parseNumeric(data) {
  const m = data && data.supplemental && data.supplemental.codeMappings;
  if (!m || typeof m !== "object") throw new Error("unexpected code mappings data");
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const code of Object.keys(m)) {
    const num = own(m, code) && own(m, code)._numeric;
    if (/^[A-Z]{2}$/.test(code) && typeof num === "string" && /^\d{1,3}$/.test(num))
      out.set(code, num.padStart(3, "0"));
  }
  return out;
}

/**
 * Fetch the alpha-2 → ISO numeric table.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function loadNumeric() {
  return parseNumeric(await getJson(URL_CODE_MAPPINGS));
}
