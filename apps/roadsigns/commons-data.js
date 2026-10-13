/**
 * Road signs — finding countries and sign artwork on Wikimedia Commons.
 *
 * Nothing here touches the page; every function takes what it needs and
 * returns plain data.
 */

import { parseTerritories, URL_TERRITORIES } from "../../shared/cldr.js";
import {
  classifyLicence,
  commonsFileUrl,
  filesIn,
  firstSafeImageUrl,
  mediawiki,
  subcategoriesOf,
  widenThumb,
} from "../../shared/commons.js";
import { getJson } from "../../shared/net.js";
import { bareName, cleanText, htmlToText, norm } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { FULL_W, HISTORIC, NAME_PREFIX, ROOT_CATEGORY, THUMB_W } from "./config.js";

/**
 * @typedef {object} Country
 * @property {string} title the Commons category, e.g. "Category:Diagrams of road signs of Germany"
 * @property {string} name the name as Commons writes it ("the United States")
 * @property {string} code ISO code from CLDR, or "" when no match was found
 * @property {string} standard CLDR's standard English name, or ""
 * @property {string[]} alts CLDR's alternative names
 */

/**
 * @typedef {object} Sign
 * @property {string} title file name, never displayed (it names the country)
 * @property {number} pageid
 * @property {string} thumb picker thumbnail URL
 * @property {string} full larger render for the sheet
 * @property {string} keywords searchable text: file name plus categories
 * @property {string[]} cats the Commons categories the file sits in
 * @property {string} author
 * @property {import("../../shared/commons.js").Licence} licence
 * @property {string} describeUrl permanent link to the file page
 * @property {boolean} historic the file name says it is historic or obsolete
 * @property {string} section which sign class it is shown under
 */

/**
 * CLDR gives the standard English name and the ISO code for each territory,
 * including the alternative names people type. Commons is matched against it
 * by a normalised name with any leading "the" removed, so "the United States"
 * and "United States" meet.
 *
 * @returns {Promise<Map<string, import("../../shared/cldr.js").Territory>>} by bare name
 */
async function loadTerritoriesByName() {
  const byName = new Map();
  for (const e of parseTerritories(await getJson(URL_TERRITORIES))) {
    for (const n of [e.name, ...e.alts]) byName.set(bareName(n), e);
  }
  return byName;
}

/**
 * Every country with a "Diagrams of road signs of …" category, with ISO codes
 * and standard names attached where CLDR knows them.
 *
 * @returns {Promise<Country[]>} sorted by name
 */
export async function loadCountries() {
  const subs = await subcategoriesOf(ROOT_CATEGORY, 500);
  /** @type {Country[]} */
  const out = [];
  for (const title of subs) {
    const bare = title.replace(/^Category:/, "");
    if (!bare.toLowerCase().startsWith(NAME_PREFIX.toLowerCase())) continue;
    const name = cleanText(bare.slice(NAME_PREFIX.length), 90);
    // Qualified subcategories such as "… of Germany by number" are not countries.
    if (!name || /\s[-–—]\s|\sby\s|\s\(/i.test(name)) continue;
    out.push({ title, name, code: "", standard: "", alts: [] });
  }
  const seen = new Set();
  const list = out.filter((c) => !seen.has(c.name) && seen.add(c.name));

  // A failure here costs the codes and the standard names, not the app.
  /** @type {Map<string, import("../../shared/cldr.js").Territory> | null} */
  let byName;
  try {
    byName = await loadTerritoriesByName();
  } catch {
    byName = null;
  }

  for (const c of list) {
    const hit = byName ? byName.get(bareName(c.name)) : null;
    c.code = hit ? hit.code : "";
    c.standard = hit ? hit.name : "";
    c.alts = hit ? hit.alts : [];
  }
  return list.sort((a, b) =>
    bareName(a.standard || a.name).localeCompare(bareName(b.standard || b.name)),
  );
}

/**
 * The category titles to try for one sign class of one country.
 *
 * The country name is taken from Commons' own category title, so it already
 * carries the definite article wherever Commons uses one — "the United
 * States", "the Czech Republic". Only the form without it is worth adding;
 * inventing "the Germany" would just waste a request on every sign class.
 *
 * @param {Country} country
 * @param {string} type e.g. "warning"
 * @returns {string[]}
 */
function categoryCandidates(country, type) {
  const c = country.name;
  const forms = [...new Set([c, c.replace(/^the\s+/i, "")])];
  const out = [];
  // SVG first: that tier holds the files, while the diagrams tier is often
  // nothing but subcategories.
  for (const f of forms) out.push(`Category:SVG ${type} road signs of ${f}`);
  for (const f of forms) out.push(`Category:Diagrams of ${type} road signs of ${f}`);
  return out;
}

/**
 * Turn one page of an `imageinfo` reply into a {@link Sign}, or `null` when
 * the file can't be used (not an image, no safe URL, nothing to cite).
 *
 * @param {any} page
 * @param {any} info `page.imageinfo[0]`
 * @param {string} section
 * @returns {Sign | null}
 */
function describeFile(page, info, section) {
  if (typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if (!pageid) return null;

  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if (!thumb) return null;

  const title = cleanText(String(page.title || "").replace(/^File:/, ""), 140);
  const ex = info.extmetadata || {};
  /** @param {string} k */
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };

  /*
    Searchable text, never displayed: the file name plus the categories it
    sits in, so "give way" finds a sign whose name is only a code.
  */
  const rawCats = Array.isArray(page.categories) ? page.categories : [];
  const cats = rawCats
    .slice(0, 40)
    .map((/** @type {any} */ c) =>
      cleanText(String((c && c.title) || "").replace(/^Category:/, ""), 90),
    )
    .filter(Boolean);
  const keywords = norm([title, ...cats].join(" "));

  return {
    title,
    pageid,
    thumb,
    keywords,
    cats,
    full: widenThumb(thumb, info.width, FULL_W) || thumb,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: commonsFileUrl(pageid),
    historic: HISTORIC.test(title),
    section,
  };
}

/**
 * Licence, author, URLs and categories for a list of files, 50 per request.
 *
 * @param {string[]} titles
 * @param {string} section the sign class the files were found under
 * @returns {Promise<Sign[]>}
 */
export async function fileInfo(titles, section) {
  /** @type {Sign[]} */
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    // Categories come back in the same request, and they carry the words
    // people actually search for: a file named "R2-3" sits in "Give way
    // signs in New Zealand".
    const data = await mediawiki({
      action: "query",
      prop: "imageinfo|categories",
      titles: titles.slice(i, i + 50).join("|"),
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: String(THUMB_W),
      cllimit: "500",
      clshow: "!hidden",
    });
    const pages = data && data.query && data.query.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      const rec = describeFile(page, info, section);
      if (rec) out.push(rec);
    }
  }
  return out;
}

/**
 * File titles for one sign class of one country, up to `budget` of them.
 *
 * A sign class often holds subcategories rather than files — Germany's
 * prohibitory diagrams are 36 subcategories and 5 loose files — so a thin
 * result is followed one level down rather than accepted.
 *
 * @param {Country} country
 * @param {string} type
 * @param {number} budget
 * @returns {Promise<string[]>}
 */
export async function titlesForSection(country, type, budget) {
  const seen = new Set();
  /** @type {string[]} */
  const found = [];
  /** @param {string} t */
  const push = (t) => {
    if (!seen.has(t) && found.length < budget) {
      seen.add(t);
      found.push(t);
    }
  };

  for (const cat of categoryCandidates(country, type)) {
    if (found.length >= budget) break;
    let titles;
    try {
      titles = await filesIn(cat, 500);
    } catch {
      continue;
    }
    titles.forEach(push);
    if (found.length >= 24) continue; // plenty here; no need to go deeper

    let subs;
    try {
      subs = await subcategoriesOf(cat, 24);
    } catch {
      subs = [];
    }
    for (const sub of subs.slice(0, 12)) {
      if (found.length >= budget) break;
      try {
        (await filesIn(sub, 60)).forEach(push);
      } catch {
        /* skip */
      }
    }
  }
  return found;
}
