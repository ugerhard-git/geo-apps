/**
 * Licence plates — finding countries and plate images on Wikimedia Commons.
 *
 * Nothing here touches the page; every function takes what it needs and
 * returns plain data.
 */

import { loadTerritories } from "../../shared/cldr.js";
import {
  classifyLicence,
  commonsFileUrl,
  firstSafeImageUrl,
  mediawiki,
  subcategoriesOf,
  widenThumb,
} from "../../shared/commons.js";
import { bareName, cleanText, htmlToText, norm } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import {
  FULL_W,
  NAME_PREFIXES,
  NOT_A_COUNTRY,
  ROOT_CATEGORIES,
  SECTION_HINTS,
  THUMB_W,
} from "./config.js";

/**
 * @typedef {object} Country
 * @property {string} title the Commons category, e.g. "Category:License plates of Spain"
 * @property {string} name the name as Commons writes it
 * @property {string} code ISO code from CLDR, or ""
 * @property {string} official CLDR's standard English name, or ""
 * @property {string[]} alts CLDR's alternative names
 */

/**
 * @typedef {object} Plate
 * @property {string} title file name (names the country, so only shown in the picker)
 * @property {number} pageid
 * @property {string[]} cats the Commons categories the file sits in
 * @property {string} keywords searchable text, never displayed
 * @property {string} thumb picker thumbnail URL
 * @property {string} full larger render for the sheet
 * @property {number} width
 * @property {number} height
 * @property {string} author
 * @property {import("../../shared/commons.js").Licence} licence
 * @property {string} describeUrl permanent link to the file page
 * @property {string} year earliest year in the file name, a hint that it's historic
 * @property {string} section "private", "commercial" or "other"
 * @property {boolean} [diagram] a drawing or sample rather than a roadside photo
 * @property {Array<{x: number, y: number, w: number, h: number}>} regions areas
 *   to blur, as fractions of the image so they survive any scaling
 */

/**
 * Licence, author, URLs and categories for up to 50 files at a time.
 *
 * @param {string[]} titles
 * @returns {Promise<Plate[]>}
 */
export async function fileInfo(titles) {
  /** @type {Plate[]} */
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const data = await mediawiki({
      // Categories ride along in the same request: they place a plate far more
      // reliably than reading its file name, and they give the filter
      // something real to match.
      action: "query",
      prop: "imageinfo|categories",
      titles: chunk.join("|"),
      cllimit: "500",
      clshow: "!hidden",
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: String(THUMB_W),
    });
    const pages = (data && data.query && data.query.pages) || [];
    for (const page of pages) {
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      const rec = describeFile(page, info);
      if (rec) out.push(rec);
    }
  }
  return out;
}

/**
 * A year in the file name is the quickest signal that a plate is historic
 * rather than current. It is a hint, not a fact — the file page settles it.
 *
 * @param {string} title
 * @returns {string} the earliest year, or ""
 */
function yearInTitle(title) {
  const years = String(title).match(/\b(1[5-9]\d{2}|20[0-4]\d)\b/g);
  if (!years) return "";
  return years
    .map(Number)
    .sort((a, b) => a - b)[0]
    .toString();
}

/**
 * @param {any} page
 * @param {any} info `page.imageinfo[0]`
 * @returns {Plate | null}
 */
function describeFile(page, info) {
  const ex = info.extmetadata || {};
  /** @param {string} k */
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };

  if (typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;

  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if (!thumb) return null;
  // The picker wants small images; the sheet wants a usable one.
  const full = widenThumb(thumb, info.width, FULL_W) || thumb;

  const title = cleanText(String(page.title || "").replace(/^File:/, ""), 140);
  // Every plate has to be citable, and the permalink is built from the page id.
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if (!pageid) return null;

  const rawCats = Array.isArray(page.categories) ? page.categories : [];
  const cats = rawCats
    .slice(0, 40)
    .map((/** @type {any} */ c) =>
      cleanText(String((c && c.title) || "").replace(/^Category:/, ""), 90),
    )
    .filter(Boolean);

  return {
    title,
    pageid,
    cats,
    // Searchable, never displayed: the file name gives the country away.
    keywords: norm([title, ...cats].join(" ")),
    thumb,
    full,
    width: Number.isFinite(info.width) ? info.width : 0,
    height: Number.isFinite(info.height) ? info.height : 0,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: commonsFileUrl(pageid),
    year: yearInTitle(String(page.title || "")),
    section: "private",
    regions: [],
  };
}

/* A spaced dash or a bracket marks a qualifier; a bare hyphen is part of a
   name like Guinea-Bissau, so it must not be treated as one. */
const QUALIFIER = /\s[-–—]\s|\s\(/;

/**
 * "Category:License plates of Spain" → "Spain"
 *
 * @param {string} title
 * @returns {string}
 */
function countryNameFrom(title) {
  const t = String(title).replace(/^Category:/, "");
  for (const p of NAME_PREFIXES) {
    if (t.toLowerCase().startsWith(p.toLowerCase())) return cleanText(t.slice(p.length), 90);
  }
  return "";
}

/**
 * Every category whose title starts with a plate prefix, for when the parent
 * category is renamed or a country simply isn't filed under it.
 *
 * @param {string} prefix
 * @param {number} [limit=500]
 * @returns {Promise<string[]>}
 */
async function categoriesByPrefix(prefix, limit) {
  const data = await mediawiki({
    action: "query",
    list: "allcategories",
    acprefix: prefix,
    aclimit: String(limit || 500),
  });
  const rows = (data && data.query && data.query.allcategories) || [];
  return rows
    .map((/** @type {any} */ r) => (typeof r === "string" ? r : (r && r.category) || ""))
    .filter(Boolean)
    .map((/** @type {string} */ c) => "Category:" + c);
}

/**
 * @typedef {object} CountryList
 * @property {Array<{title: string, name: string}>} list
 * @property {string} via which category or prefix the list came from
 * @property {string[]} tried what failed before that, for error messages
 */

/**
 * Find the per-country plate categories: several parent categories are tried,
 * then a scan of category titles.
 *
 * @returns {Promise<CountryList>}
 * @throws an Error with a `tried` array when nothing works
 */
export async function loadCountries() {
  /** @type {string[]} */
  const tried = [];
  for (const root of ROOT_CATEGORIES) {
    try {
      const subs = await subcategoriesOf(root, 500);
      const named = subs
        .filter((t) => !QUALIFIER.test(t))
        .map((t) => ({ title: t, name: countryNameFrom(t) }))
        .filter((c) => c.name);
      if (named.length) return { list: named, via: root, tried };
      tried.push(`${root} → empty`);
    } catch (e) {
      tried.push(`${root} → ${cleanText(e && e.message, 30)}`);
    }
  }
  // Nothing under a parent category; scan titles instead.
  for (const prefix of NAME_PREFIXES) {
    try {
      const cats = await categoriesByPrefix(prefix, 500);
      const named = cats
        .filter((t) => !QUALIFIER.test(t)) // skip qualified subcategories
        .map((t) => ({ title: t, name: countryNameFrom(t) }))
        .filter((c) => c.name);
      if (named.length) return { list: named, via: `titles starting "${prefix}"`, tried };
      tried.push(`prefix "${prefix}" → empty`);
    } catch (e) {
      tried.push(`prefix "${prefix}" → ${cleanText(e && e.message, 30)}`);
    }
  }
  const err = /** @type {Error & {tried: string[]}} */ (new Error("no plate categories found"));
  err.tried = tried;
  throw err;
}

/**
 * Give each country its ISO code and standard name, matched by name.
 * Codes are an improvement, not a requirement: on failure they stay empty.
 *
 * @param {Country[]} countries
 * @returns {Promise<Country[]>}
 */
export async function attachCodes(countries) {
  const territories = await loadTerritories(NOT_A_COUNTRY);
  const index = new Map();
  for (const t of territories) {
    index.set(bareName(t.name), t);
    for (const a of t.alts) if (!index.has(bareName(a))) index.set(bareName(a), t);
  }
  for (const c of countries) {
    const hit = index.get(bareName(c.name));
    if (hit) {
      c.code = hit.code;
      c.official = hit.name;
      c.alts = hit.alts;
    } else {
      c.code = "";
      c.official = "";
      c.alts = [];
    }
  }
  return countries;
}

/**
 * Which section a plate belongs in. Commons' own categories say what a plate
 * is far better than its file name does, so they are read first and the name
 * is only the fallback.
 *
 * @param {string} title
 * @param {string} categoryTitle the category it was found in
 * @param {string[]} cats
 * @returns {string}
 */
export function guessSection(title, categoryTitle, cats) {
  const fromCats = Array.isArray(cats) ? cats.join(" ") : "";
  for (const [name, re] of SECTION_HINTS) if (re.test(fromCats)) return name;
  const hay = `${title} ${categoryTitle || ""}`;
  for (const [name, re] of SECTION_HINTS) if (re.test(hay)) return name;
  return "private";
}

/**
 * Diagrams and sample plates are listed first; roadside photographs carry
 * real registration numbers.
 *
 * @param {{title: string}} rec
 * @returns {boolean}
 */
export function looksLikeDiagram(rec) {
  return (
    /\.svg$/i.test(rec.title) ||
    /\b(sample|specimen|diagram|blank|template|muster|mock)\b/i.test(rec.title)
  );
}
