/**
 * Alphabets — countries, their languages and each language's letters, from
 * CLDR; sample sentences from the UDHR.
 *
 * `loadCore()` must finish before the other functions are used.
 */

import { CLDR_VERSION, NOT_A_COUNTRY } from "../../shared/cldr.js";
import { httpError } from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import {
  MAX_CELLS,
  MIN_SHARE,
  RTL_SCRIPTS,
  UDHR_CODE,
  URL_LANGUAGE_DATA,
  URL_LANG_NAMES,
  URL_TERRITORY_INFO,
  URL_TERR_NAMES,
  charactersUrl,
  udhrUrl,
} from "./config.js";
import { casePair, parseUnicodeSet, scriptOf } from "./unicode.js";

/* ═══════════════════════════════════════════════════════════
   Fetching, with every response kept for the session
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<string, any>} */
const cache = new Map();

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url);
  if (!r.ok) throw httpError(r.status);
  const data = await r.json();
  cache.set(url, data);
  return data;
}

/* ═══════════════════════════════════════════════════════════
   The CLDR model
   ═══════════════════════════════════════════════════════════ */

/** @type {Record<string, any>} */
let territoryInfo = {};
/** @type {Record<string, any>} */
let languageData = {};
/** @type {Record<string, string>} */
let langNames = {};
/** @type {Record<string, string>} */
let terrNames = {};

/** Load the CLDR tables every other function here relies on. */
export async function loadCore() {
  const [ti, ld, ln, tn] = await Promise.all([
    getJson(URL_TERRITORY_INFO),
    getJson(URL_LANGUAGE_DATA),
    getJson(URL_LANG_NAMES),
    getJson(URL_TERR_NAMES),
  ]);
  const info = ti && ti.supplemental && ti.supplemental.territoryInfo;
  const data = ld && ld.supplemental && ld.supplemental.languageData;
  langNames =
    (ln.main &&
      ln.main.en &&
      ln.main.en.localeDisplayNames &&
      ln.main.en.localeDisplayNames.languages) ||
    {};
  terrNames =
    (tn.main &&
      tn.main.en &&
      tn.main.en.localeDisplayNames &&
      tn.main.en.localeDisplayNames.territories) ||
    {};
  if (!info || !data) throw new Error("CLDR supplemental data was not in the expected shape");
  territoryInfo = info;
  languageData = data;
}

/**
 * Every country CLDR has language data for.
 *
 * @returns {Array<{code: string, name: string}>} sorted by name
 */
export function countryList() {
  const out = [];
  for (const code of Object.keys(territoryInfo)) {
    if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const name = own(terrNames, code);
    if (typeof name !== "string") continue;
    out.push({ code, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @typedef {object} CountryLanguage
 * @property {string} lang BCP-47 code
 * @property {number} share percent of the population
 * @property {boolean} official
 * @property {string} status CLDR's official-status value
 */

/**
 * Languages worth offering for a country: anything widely spoken, plus
 * anything official. Official ones first, then by share.
 *
 * @param {string} code
 * @returns {CountryLanguage[]}
 */
export function languagesFor(code) {
  const info = own(territoryInfo, code);
  const pops = info && info.languagePopulation;
  if (!pops) return [];
  const out = [];
  for (const lang of Object.keys(pops)) {
    const p = pops[lang];
    const share = parseFloat(p && p._populationPercent);
    const status = p && p._officialStatus;
    const official = status === "official" || status === "de_facto_official";
    if (!official && !(share >= MIN_SHARE)) continue;
    out.push({
      lang: lang.replace(/_/g, "-"),
      share: Number.isFinite(share) ? share : 0,
      official,
      status: status || "",
    });
  }
  return out.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.share - a.share);
}

/**
 * The English name of a language or locale.
 *
 * @param {string} code
 * @returns {string}
 */
export function languageName(code) {
  const direct = own(langNames, code) || own(langNames, code.replace(/-/g, "_"));
  if (typeof direct === "string") return direct;
  const base = code.split("-")[0];
  const b = own(langNames, base);
  return typeof b === "string" ? b : code;
}

/**
 * A language may be written in more than one script; CLDR keeps those as
 * separate locales ("sr", "sr-Latn"), so each is offered.
 *
 * @param {string} lang
 * @returns {string[]}
 */
export function scriptVariants(lang) {
  const base = lang.split("-")[0];
  const entry = own(languageData, base) || own(languageData, base + "-alt-secondary");
  const scripts =
    entry && typeof entry._scripts === "string" ? entry._scripts.trim().split(/\s+/) : [];
  const out = [lang];
  for (const sc of scripts.slice(1)) if (/^[A-Z][a-z]{3}$/.test(sc)) out.push(base + "-" + sc);
  return out;
}

/**
 * Whether CLDR has character data for a locale.
 *
 * @param {string} locale
 * @returns {Promise<boolean>}
 */
export async function hasCharacters(locale) {
  try {
    const data = await getJson(charactersUrl(locale));
    const main = data && data.main;
    const key = main && Object.keys(main)[0];
    return !!(key && main[key].characters);
  } catch {
    return false; // CLDR simply has no data for this locale
  }
}

/**
 * @typedef {object} Alphabet
 * @property {string} locale
 * @property {string} url where the letters came from
 * @property {string} script
 * @property {number} total characters in the full set
 * @property {boolean} truncated more than {@link MAX_CELLS}
 * @property {boolean} rtl
 * @property {string} name the language's English name
 * @property {import("./unicode.js").CasePair[]} letters
 * @property {import("./unicode.js").CasePair[]} aux letters used only in loanwords
 * @property {string} cldrVersion
 * @property {{text: string, url: string, code: string} | null} [sentence] the
 *   sample sentence; `undefined` until looked up, `null` when there is none
 */

/**
 * A locale's letters, ready to draw.
 *
 * @param {string} locale
 * @returns {Promise<Alphabet>}
 */
export async function buildAlphabet(locale) {
  const url = charactersUrl(locale);
  const data = await getJson(url);
  const main = data && data.main;
  const key = main && Object.keys(main)[0];
  const chars = key && main[key] && main[key].characters;
  if (!chars || typeof chars.exemplarCharacters !== "string")
    throw new Error("no exemplar characters for " + locale);
  const letters = parseUnicodeSet(chars.exemplarCharacters);
  const aux = typeof chars.auxiliary === "string" ? parseUnicodeSet(chars.auxiliary) : [];
  if (!letters.length) throw new Error("empty exemplar set for " + locale);
  const script = scriptOf(letters.slice(0, 40).join(""));
  const total = letters.length;
  return {
    locale,
    url,
    script,
    total,
    truncated: total > MAX_CELLS,
    rtl: RTL_SCRIPTS.has(script),
    name: languageName(locale),
    letters: letters.slice(0, MAX_CELLS).map((l) => casePair(l, locale)),
    aux: aux.slice(0, MAX_CELLS).map((l) => casePair(l, locale)),
    cldrVersion:
      (data.main[key].identity &&
        data.main[key].identity.version &&
        data.main[key].identity.version._cldrVersion) ||
      CLDR_VERSION,
  };
}

/* ═══════════════════════════════════════════════════════════
   Sample sentence (UDHR Article 1)
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<string, string>} */
const htmlCache = new Map();

/**
 * The first sentence of Article 1 of the Universal Declaration of Human
 * Rights in a locale's language.
 *
 * @param {string} locale
 * @returns {Promise<{text: string, url: string, code: string} | null>}
 */
export async function sampleSentence(locale) {
  const base = locale.split("-")[0];
  const codes = own(UDHR_CODE, base);
  if (!codes) return null;
  for (const code of codes) {
    const url = udhrUrl(code);
    try {
      let html = htmlCache.get(url);
      if (html === undefined) {
        const r = await fetch(url);
        if (!r.ok) continue;
        html = await r.text();
        htmlCache.set(url, html);
      }
      // Parsed into a detached document and read as text only; nothing from
      // this file is ever inserted into the page as markup.
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.querySelector("article p") || doc.querySelector("p");
      if (!node) continue;
      const full = cleanText(node.textContent, 400);
      if (!full) continue;
      const cut = full.search(/[.!?。！？۔।](\s|$)/);
      const text = cut > 20 ? full.slice(0, cut + 1) : full.slice(0, 180);
      return { text, url, code };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
