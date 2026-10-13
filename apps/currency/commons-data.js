/**
 * Currency sheets — banknote and coin images on Wikimedia Commons.
 */

import {
  UPLOAD_HOST,
  classifyLicence,
  commonsFileUrl,
  firstSafeImageUrl,
  mediawiki,
  widenThumb,
} from "../../shared/commons.js";
import { cleanText, htmlToText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { FULL_W, THUMB_W } from "./config.js";

/**
 * @typedef {object} Piece a banknote or coin image
 * @property {string} title file name (names the country, so never shown)
 * @property {number | null} pageid
 * @property {string} thumb picker thumbnail URL
 * @property {string} full larger render for the sheet
 * @property {string} author
 * @property {import("../../shared/commons.js").Licence} licence
 * @property {string} describeUrl link to the file page
 * @property {string} year earliest year in the file name, a hint that it's historic
 * @property {string} section "notes", "coins" or "article"
 * @property {boolean} [fromArticle] the currency article's own illustration
 * @property {boolean} [nonFree] hosted on Wikipedia under a non-free licence
 * @property {boolean} [local] hosted on Wikipedia rather than Commons
 * @property {boolean} [guessedFromArticle] picked from the article's files by name
 */

/**
 * The hosts of rejected URLs, for a message worth reading.
 *
 * @param {...unknown} candidates
 * @returns {string}
 */
export function describeRejectedUrl(...candidates) {
  const seen = candidates.filter(Boolean).map((c) => {
    try {
      return new URL(String(c), "https://" + UPLOAD_HOST + "/").host;
    } catch {
      return "unparseable";
    }
  });
  return seen.length ? seen.join(", ") : "no URL at all";
}

/**
 * A year in the file name is the quickest signal that a note is historic
 * rather than current. It is a hint, not a fact — the file page settles it.
 *
 * @param {string} title
 * @returns {string} the earliest year (several usually mean a series range), or ""
 */
export function yearInTitle(title) {
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
 * @param {string} section
 * @returns {Piece | null}
 */
function describeFile(page, info, section) {
  if (typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;
  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if (!thumb) return null;
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if (!pageid) return null; // an image we cannot cite is unusable

  const ex = info.extmetadata || {};
  /** @param {string} k */
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };

  return {
    title: cleanText(String(page.title || "").replace(/^File:/, ""), 140),
    pageid,
    thumb,
    full: widenThumb(thumb, info.width, FULL_W) || thumb,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: commonsFileUrl(pageid),
    year: yearInTitle(String(page.title || "")),
    section,
  };
}

/**
 * Files directly in a Commons category.
 *
 * @param {string} title
 * @param {number} [limit=200]
 * @returns {Promise<string[]>}
 */
export async function filesIn(title, limit) {
  const data = await mediawiki({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmtype: "file",
    cmlimit: String(limit || 200),
  });
  const rows = (data && data.query && data.query.categorymembers) || [];
  return rows
    .map((/** @type {any} */ r) => (typeof r.title === "string" ? r.title : ""))
    .filter(Boolean);
}

/**
 * Licence, author and URLs for a list of files, 50 per request.
 *
 * @param {string[]} titles
 * @param {string} section
 * @returns {Promise<Piece[]>}
 */
export async function fileInfo(titles, section) {
  /** @type {Piece[]} */
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    const data = await mediawiki({
      action: "query",
      prop: "imageinfo",
      titles: titles.slice(i, i + 50).join("|"),
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: String(THUMB_W),
      redirects: "1", // a renamed file leaves its old name behind
    });
    for (const page of (data && data.query && data.query.pages) || []) {
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      const rec = describeFile(page, info, section);
      if (rec) out.push(rec);
    }
  }
  return out;
}

/**
 * The categories to search for a country's notes and coins.
 *
 * Category naming varies: a euro country's own category holds mostly
 * historical money, while the current notes sit under the currency's name.
 * Both are tried.
 *
 * @param {{name: string}} country
 * @param {import("./reference.js").Currency | null} currency
 * @returns {{notes: string[], coins: string[]}}
 */
export function categoryCandidates(country, currency) {
  const c = country.name;
  const bare = c.replace(/^the\s+/i, "");
  /*
    Commons is inconsistent about the definite article — "Banknotes of Germany"
    but "Banknotes of the United States" — and CLDR's name carries no "the".
    Trying both costs one wasted request; trying one costs the whole country.
  */
  const forms = [...new Set([c, bare, `the ${bare}`])];

  const notes = forms.map((f) => `Category:Banknotes of ${f}`);
  const coins = forms.map((f) => `Category:Coins of ${f}`);

  if (currency && currency.name) {
    const cur = currency.name;
    notes.unshift(`Category:${cur} banknotes`);
    coins.unshift(`Category:${cur} coins`);
    // Only the euro files its coins by issuing country, because only the euro
    // has country-specific national sides.
    if (currency.code === "EUR") coins.unshift(`Category:Euro coins of ${bare}`);
  }
  return { notes: [...new Set(notes)], coins: [...new Set(coins)] };
}
