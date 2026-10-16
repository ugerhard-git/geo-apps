/**
 * Country statistics — a first guess at which labels give the answer away.
 *
 * "Hungarian 84%" on a sheet about Hungary is the answer. The app hides such
 * labels to start with (they show as "?"), and the user can show them again
 * or hide others. The guess only has to be good, not perfect: it errs on the
 * side of hiding, because a hidden label costs a click and a shown one spoils
 * the quiz.
 *
 * Pure functions, so they can be tested without a browser.
 */

import { norm } from "../../shared/text.js";
import { own } from "../../shared/util.js";

/** Only the statistics about people name things after countries. */
const PEOPLE_STATS = new Set(["languages", "ethnicity", "religion"]);

/** Official for the whole country, not just a region of it. */
const NATIONAL = /^(?:official|de_facto_official)$/;

/** Words that share a beginning with a country's name by chance. */
const IGNORE = new Set(["other", "others", "unspecified", "unknown", "mixed", "none", "native"]);

/**
 * How many letters two words share at the start.
 *
 * @param {string} a
 * @param {string} b
 */
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** @param {string} text */
const words = (text) =>
  norm(text)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !IGNORE.has(w));

/**
 * Whether a label starts like one of the country's names: "Hungarian" and
 * Hungary, "Japanese" and Japan, "Iraqi" and Iraq. Four letters in common
 * at least, so "Indian" doesn't match Indonesia.
 *
 * @param {string} label
 * @param {string[]} names the country's name and its other names
 */
export function namesCountry(label, names) {
  const nameWords = names.flatMap(words);
  return words(label).some((w) => nameWords.some((n) => sharedStart(w, n) >= 4));
}

/**
 * How many territories have each language as an official one.
 *
 * @param {Record<string, any>} territoryInfo CLDR supplemental territory info
 * @returns {Map<string, number>} by language code
 */
export function officialCounts(territoryInfo) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const t of Object.keys(territoryInfo || {})) {
    const pop = own(territoryInfo, t)?.languagePopulation;
    if (!pop) continue;
    for (const code of Object.keys(pop))
      if (NATIONAL.test(String(own(pop, code)?._officialStatus || "")))
        counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
}

/**
 * The labels of one chart to hide to start with.
 *
 * @param {string} statId
 * @param {Array<{label: string, code?: string, isOther?: boolean}>} slices
 * @param {{code: string, name: string, alts?: string[]}} country
 * @param {Record<string, any>} territoryInfo
 * @param {Map<string, number>} [counts] from {@link officialCounts}, if already worked out
 * @returns {Set<string>} labels
 */
export function guessHidden(statId, slices, country, territoryInfo, counts) {
  /** @type {Set<string>} */
  const hidden = new Set();
  if (!PEOPLE_STATS.has(statId)) return hidden;
  const names = [country.name, ...(country.alts || [])];
  const official = counts || officialCounts(territoryInfo);
  const here = own(territoryInfo, country.code)?.languagePopulation || {};
  for (const s of slices) {
    if (s.isOther) continue;
    if (namesCountry(s.label, names)) hidden.add(s.label);
    // A language official here and in at most one other country points
    // straight at it: Hungarian, Greek, Estonian.
    if (statId === "languages" && s.code) {
      const status = String(own(here, s.code)?._officialStatus || "");
      if (NATIONAL.test(status) && (official.get(s.code) || 0) <= 2) hidden.add(s.label);
    }
  }
  return hidden;
}
