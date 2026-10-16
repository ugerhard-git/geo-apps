/**
 * Country statistics — turning each source's data into a chart series.
 */

import { CLDR_VERSION } from "../../shared/cldr.js";
import { bareName, cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { FACTBOOK_ARCHIVED, OWID_CHARTS, RELIGION_YEAR, WB_INDICATORS } from "./config.js";
import {
  languageNames,
  loadCountryCodes,
  loadFactbook,
  loadReligion,
  owidShares,
  worldBank,
} from "./sources.js";

/**
 * @typedef {import("./sources.js").Slice & {
 *   isOther?: boolean,
 *   code?: string,
 *   hideName?: boolean,
 * }} Slice
 *   `code` is the language code, for language slices; `hideName` draws the
 *   label as "?"
 */

/**
 * @typedef {object} Series
 * @property {Slice[]} slices
 * @property {number} folded how many small categories were gathered into "Other"
 * @property {string} note the source line printed under the chart
 * @property {boolean} [absolute] values are already shares of the population
 *   (and may add up to more than 100), so they are never renormalised
 * @property {string} [unit] what the values measure, when not shares
 * @property {number} [offTotal] a set that claims to be shares but doesn't add up to 100
 * @property {number} [dropped] categories that couldn't be read as a number
 * @property {boolean} [overHundred] shares total more than 100%
 */

/**
 * Gather the smallest slices into "Other". Pies are unreadable past about
 * eight slices; the gathered count is reported, so nobody mistakes "Other"
 * for a single thing.
 *
 * @param {Slice[]} slices
 * @param {number} limit
 * @returns {{slices: Slice[], folded: number}}
 */
export function condense(slices, limit) {
  const sorted = slices.slice().sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return { slices: sorted, folded: 0 };
  const keep = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);
  const sum = rest.reduce((s, r) => s + r.value, 0);
  if (sum > 0) keep.push({ label: "Other", value: sum, isOther: true });
  return { slices: keep, folded: rest.length };
}

/**
 * Split on commas that are not inside brackets, so a parenthetical breakdown
 * stays with the category it belongs to.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(text)) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

const YEAR_NOTE = /\((?:\d{4}(?:\s*est\.?)?|est\.?)\)\s*$/i;
const SHARE = /^(.*?)[\s,]+(\d+(?:\.\d+)?)\s*%$/;

/**
 * Parse a Factbook share list:
 * "Hungarian 84.3%, Romani 2.1%, other 1.2%, unspecified 13.7% (2022 est.)"
 *
 * Anything that will not yield a single clean number — a range, a "<1%" — is
 * dropped and counted rather than guessed at.
 *
 * @param {unknown} raw
 * @returns {{slices: Slice[], dropped: number, year: string}}
 */
export function parseShareList(raw) {
  const plain = String(raw || "").replace(/<[^>]*>/g, " ");
  const yearMatch = /\((\d{4})[^)]*\)\s*$/.exec(plain);
  const year = yearMatch ? yearMatch[1] : "";
  const body = plain.replace(YEAR_NOTE, "").trim();
  /** @type {Slice[]} */
  const slices = [];
  let dropped = 0;
  for (const part of splitTopLevel(body)) {
    const cleaned = part.replace(/\([^)]*\)/g, " ").trim();
    const m = SHARE.exec(cleaned);
    if (!m) {
      if (/\d/.test(cleaned)) dropped++;
      continue;
    }
    const label = cleanText(m[1], 42);
    const value = parseFloat(m[2]);
    if (!label || !Number.isFinite(value) || value <= 0) {
      dropped++;
      continue;
    }
    slices.push({ label, value });
  }
  return { slices, dropped, year };
}

/**
 * Build the series for one statistic and one country.
 *
 * @param {string} id a statistic id from config.js
 * @param {import("../../shared/cldr.js").Territory} country
 * @param {Record<string, any>} territoryInfo CLDR territory info
 * @returns {Promise<Series | null>} `null` when there is no data
 */
export async function buildSeries(id, country, territoryInfo) {
  if (id === "languages") {
    const rec = own(territoryInfo, country.code);
    const pop = rec && rec.languagePopulation;
    if (!pop) return null;
    const names = await languageNames();
    /** @type {Slice[]} */
    const slices = [];
    for (const code of Object.keys(pop)) {
      const entry = own(pop, code);
      const pct = entry && parseFloat(entry._populationPercent);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      slices.push({ label: cleanText(own(names, code) || code, 40), value: pct, code });
    }
    if (!slices.length) return null;
    const { slices: kept, folded } = condense(slices, 8);
    /*
      These are shares of the population, not slices of one: CLDR puts German
      at 91% and English at 56% for Germany, because a second language counts
      too. So they must not be renormalised, and a pie would be a lie.
    */
    return { slices: kept, folded, absolute: true, note: "CLDR " + CLDR_VERSION };
  }

  if (id === "religion") {
    const table = await loadReligion();
    const forms = [country.name, ...(country.alts || [])].map(bareName);
    let slices = null;
    for (const f of forms) {
      if (table.has(f)) {
        slices = table.get(f);
        break;
      }
    }
    if (!slices || !slices.length) return null;
    const { slices: kept, folded } = condense(slices, 8);
    return { slices: kept, folded, note: `Pew Research, ${RELIGION_YEAR}` };
  }

  const chart = own(OWID_CHARTS, id);
  if (chart) {
    const map = await loadCountryCodes();
    const entry = map.get(country.code);
    if (!entry || !entry.iso3) return null;
    const got = await owidShares(chart.slug, entry.iso3);
    if (!got) return null;
    const { slices: kept, folded } = condense(got.slices, 8);
    const sum = got.slices.reduce((t, x) => t + x.value, 0);
    return {
      slices: kept,
      folded,
      note: `Our World in Data${got.year ? " " + got.year : ""}`,
      unit: chart.unit || "",
      // Only a set that claims to be shares can fail to add up to 100.
      offTotal: chart.shares && Math.abs(sum - 100) > 5 ? Math.round(sum) : 0,
    };
  }

  if (id === "ethnicity") {
    const book = await loadFactbook(country.code);
    if (!book) return null;
    const people = own(book, "People and Society");
    const field = people && own(people, "Ethnic groups");
    const parsed = parseShareList(field && field.text);
    if (!parsed.slices.length) return null;
    const { slices: kept, folded } = condense(parsed.slices, 10);
    const sum = parsed.slices.reduce((t, x) => t + x.value, 0);
    return {
      slices: kept,
      folded,
      dropped: parsed.dropped,
      absolute: true,
      note: `CIA World Factbook${parsed.year ? " " + parsed.year : ""}, ${FACTBOOK_ARCHIVED}`,
      overHundred: sum > 100.5,
    };
  }

  const spec = own(WB_INDICATORS, id);
  if (!spec) return null;
  const results = [];
  for (const [code, label] of spec) {
    let got;
    try {
      got = await worldBank(country.code, code);
    } catch {
      got = null;
    }
    if (got) results.push({ label, value: got.value, year: got.year });
  }
  if (!results.length) return null;
  const year =
    results
      .map((r) => r.year)
      .filter(Boolean)
      .sort()
      .pop() || "";
  /** @type {Slice[]} */
  const slices = results.map((r) => ({ label: r.label, value: r.value }));
  // These describe parts of a whole; the rest is real and must be shown.
  const rest = { land: "Other land", exports: "Other goods" }[id];
  if (rest) {
    const used = slices.reduce((s, x) => s + x.value, 0);
    if (used < 99.5) slices.push({ label: rest, value: Math.max(0, 100 - used) });
  }
  if (id === "urban") {
    const urban = slices[0] ? slices[0].value : 0;
    slices.push({ label: "Rural", value: Math.max(0, 100 - urban) });
  }
  return { slices, folded: 0, note: `World Bank, ${year}` };
}
