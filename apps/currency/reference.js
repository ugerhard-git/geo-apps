/**
 * Currency sheets — countries, and which currency each one uses, from CLDR.
 */

import { URL_TERRITORIES, parseTerritories } from "../../shared/cldr.js";
import { getJson } from "../../shared/net.js";
import { bareName, cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { URL_CURRENCY_DATA, URL_CURRENCY_NAMES } from "./config.js";

/**
 * @typedef {object} Currency
 * @property {string} code ISO 4217 code, e.g. "THB"
 * @property {string} name e.g. "Thai Baht"
 * @property {string} plural e.g. "Thai baht"
 * @property {string} symbol e.g. "฿"
 * @property {number} digits decimal places of the subunit (2 for cents)
 */

/**
 * @typedef {object} Reference
 * @property {import("../../shared/cldr.js").Territory[]} countries sorted by name
 * @property {(code: string) => Currency | null} currencyFor the currency a
 *   territory uses today, or `null` when CLDR lists no current legal tender
 */

/**
 * Load the territory list and CLDR's currency tables.
 *
 * @returns {Promise<Reference>}
 */
export async function loadReference() {
  const [terr, cur, names] = await Promise.all([
    getJson(URL_TERRITORIES),
    getJson(URL_CURRENCY_DATA),
    getJson(URL_CURRENCY_NAMES),
  ]);

  const countries = parseTerritories(terr).sort((a, b) =>
    bareName(a.name).localeCompare(bareName(b.name)),
  );

  const cd = cur && cur.supplemental && cur.supplemental.currencyData;
  if (!cd || !cd.region) throw new Error("unexpected currency data");
  const regions = cd.region;
  const fractions = cd.fractions || {};
  const currencyNames =
    (names.main && names.main.en && names.main.en.numbers && names.main.en.numbers.currencies) ||
    {};
  if (!countries.length) throw new Error("no countries returned");

  /**
   * The currency in current use, per CLDR's tender history.
   *
   * @param {string} code ISO territory code
   * @returns {Currency | null}
   */
  function currencyFor(code) {
    const history = own(regions, code);
    if (!Array.isArray(history)) return null;
    let found = null;
    for (const entry of history) {
      for (const c of Object.keys(entry)) {
        const meta = own(entry, c);
        if (!meta || meta._to) continue; // superseded
        if (meta._tender === "false") continue; // not legal tender
        found = c;
      }
    }
    if (!found) return null;
    const rec = own(currencyNames, found) || {};
    const frac = own(fractions, found) || own(fractions, "DEFAULT") || {};
    const digits = parseInt(frac._digits, 10);
    return {
      code: found,
      name: cleanText(rec.displayName || found, 60),
      plural: cleanText(rec["displayName-count-other"] || "", 60),
      symbol: cleanText(rec.symbol || "", 12),
      digits: Number.isFinite(digits) ? digits : 2,
    };
  }

  return { countries, currencyFor };
}
