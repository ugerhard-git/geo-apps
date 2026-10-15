/**
 * Letter frequencies — reading data/letters.json (built by
 * scripts/letters/build-data.mjs from FineFreq) and choosing the bars.
 *
 * The file is ours, but it is still checked before use: codes must match
 * their patterns, every letter must be one Latin letter or mark, every share
 * a number from 0 to 100, and the file is size-capped. Letters only reach a
 * canvas as text.
 */

import { own } from "../../shared/util.js";

/** Far above the real file (about 60 KB). */
export const MAX_BYTES = 1_000_000;

/** A letter in the data: one Latin letter, modifier letter or combining mark. */
const LETTER = /^(?:\p{Script=Latin}|[ʹ-ʿˈˊˋꞌ]|[̀-ͯ])$/u;
/** The basic 26, which are always shown however rare. */
const BASIC = /^[a-z]$/;

/**
 * @typedef {object} Language
 * @property {string} code CLDR code ("de")
 * @property {string} name English name
 * @property {number} letters how many letters FineFreq counted
 * @property {Array<[string, number]>} top letter and share in %, most common first
 */

/**
 * @typedef {object} LetterData
 * @property {Map<string, Language>} languages
 * @property {Map<string, string[]>} countries ISO code → language codes, largest first
 */

/**
 * Check and convert the parsed file.
 *
 * @param {any} json
 * @returns {LetterData}
 * @throws when the file doesn't have the expected shape
 */
export function parseData(json) {
  if (!json || typeof json !== "object" || !json.languages || !json.countries)
    throw new Error("unexpected letter data");
  /** @type {Map<string, Language>} */
  const languages = new Map();
  for (const code of Object.keys(json.languages)) {
    const l = own(json.languages, code);
    if (!/^[a-z]{2,3}$/.test(code) || !l || typeof l.name !== "string" || !Array.isArray(l.top))
      continue;
    const name = l.name.slice(0, 60);
    const top = l.top
      .filter(
        (/** @type {any} */ e) =>
          Array.isArray(e) &&
          typeof e[0] === "string" &&
          LETTER.test(e[0]) &&
          typeof e[1] === "number" &&
          e[1] >= 0 &&
          e[1] <= 100,
      )
      .slice(0, 120)
      .map((/** @type {[string, number]} */ e) => /** @type {[string, number]} */ ([e[0], e[1]]));
    if (top.length < 15) continue;
    const letters = Number.isFinite(l.letters) && l.letters > 0 ? l.letters : 0;
    languages.set(code, { code, name, letters, top });
  }
  /** @type {Map<string, string[]>} */
  const countries = new Map();
  for (const cc of Object.keys(json.countries)) {
    const codes = own(json.countries, cc);
    if (!/^[A-Z]{2}$/.test(cc) || !Array.isArray(codes)) continue;
    const ok = codes.filter((c) => typeof c === "string" && languages.has(c)).slice(0, 8);
    if (ok.length) countries.set(cc, ok);
  }
  if (!languages.size || !countries.size) throw new Error("the letter data is incomplete");
  return { languages, countries };
}

/**
 * Fetch and check the data.
 *
 * @returns {Promise<LetterData>}
 */
export async function loadData() {
  const r = await fetch("data/letters.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new Error("the letter file is too large");
  return parseData(JSON.parse(text));
}

/**
 * @typedef {object} BarOptions
 * @property {"frequency" | "alphabet"} order
 * @property {boolean} basicOnly only a–z (the harder clue)
 * @property {number} minPercent letters beyond a–z rarer than this are left out
 */

/**
 * @typedef {object} Bar
 * @property {string} letter
 * @property {number} percent
 * @property {boolean} extra beyond a–z
 * @property {number | null} english the letter's share in English, for comparison; null when English has no such letter or there's no comparison
 */

/**
 * The bars to draw for a language.
 *
 * @param {Language} lang
 * @param {BarOptions} opts
 * @param {Language | null} [english] compare each letter with English; English's own letters are a–z
 * @returns {Bar[]}
 */
export function barsFor(lang, opts, english = null) {
  /** @type {Map<string, number>} */
  const en = new Map(english && english !== lang ? english.top.filter(([l]) => BASIC.test(l)) : []);
  const bars = lang.top
    .map(([letter, percent]) => ({
      letter,
      percent,
      extra: !BASIC.test(letter),
      english: en.has(letter) ? /** @type {number} */ (en.get(letter)) : null,
    }))
    .filter((b) => (b.extra ? !opts.basicOnly && b.percent >= opts.minPercent : true));
  if (opts.order === "alphabet") {
    // The language's own alphabetical order: Swedish puts å ä ö after z.
    let collator;
    try {
      collator = new Intl.Collator(lang.code, { sensitivity: "variant" });
    } catch {
      collator = new Intl.Collator("en");
    }
    bars.sort((a, b) => collator.compare(a.letter, b.letter));
  }
  return bars;
}
