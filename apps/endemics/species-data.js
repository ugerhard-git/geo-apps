/**
 * Endemic animals — which species are endemic (Wikipedia) and their
 * photographs (Wikimedia Commons).
 *
 * Wikipedia's own categories are used rather than a Wikidata query. Wikidata
 * holds the better-structured answer, but the query needed to reach it —
 * matching endemism recorded against states and islands as well as countries —
 * was expensive enough that the service abandoned it, and a refused request
 * gives the browser no status to report. This asks a far simpler question:
 * which articles are in "Endemic fauna of <country>".
 */

import {
  classifyLicence,
  commonsFileUrl,
  firstSafeImageUrl,
  mediawiki,
  widenThumb,
} from "../../shared/commons.js";
import { cleanText, htmlToText, norm } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { wikipedia } from "../../shared/wikipedia.js";
import { FULL_W, MAX_SPECIES, NOT_A_SPECIES, THUMB_W } from "./config.js";

/**
 * @typedef {object} Taxon a species article with a lead image
 * @property {string} qid a stable id ("W" + Wikipedia page id)
 * @property {string} fileTitle the lead image, e.g. "File:Ring-tailed lemur.jpg"
 * @property {string} name the article title, which is the species' name
 * @property {string} home ISO code of the country it is endemic to
 * @property {string} articleUrl
 */

/**
 * @typedef {Taxon & {
 *   pageid: number,
 *   thumb: string,
 *   full: string,
 *   author: string,
 *   licence: import("../../shared/commons.js").Licence,
 *   describeUrl: string,
 *   keywords: string,
 * }} Species a taxon whose photograph can be used
 */

/**
 * Wikipedia is inconsistent about the definite article, so both forms are
 * tried. A category that does not exist simply returns nothing.
 *
 * @param {string} name
 * @returns {string[]}
 */
function categoryCandidates(name) {
  const bare = String(name).replace(/^the\s+/i, "");
  const forms = [...new Set([name, bare, "the " + bare])];
  const out = [];
  for (const f of forms) out.push(`Category:Endemic fauna of ${f}`);
  for (const f of forms) out.push(`Category:Endemic animals of ${f}`);
  return out;
}

/**
 * @param {any} data a `list=categorymembers` reply
 * @param {"page" | "subcat"} kind
 * @returns {string[]}
 */
function memberTitles(data, kind) {
  const rows = data && data.query && data.query.categorymembers;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.title === "string")
    .filter((r) => (kind === "subcat" ? /^Category:/.test(r.title) : !/^Category:/.test(r.title)))
    .map((r) => r.title);
}

/**
 * @param {string} title
 * @param {"page" | "subcat"} kind
 * @param {number} [limit=500]
 * @returns {Promise<string[]>}
 */
async function categoryMembers(title, kind, limit) {
  const data = await wikipedia({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmtype: kind,
    cmlimit: String(limit || 500),
  });
  return memberTitles(data, kind);
}

/**
 * The species articles in a country's endemic-fauna category, and one level
 * of its subcategories when it is mostly made of them.
 *
 * @param {string} countryName
 * @returns {Promise<{titles: string[], tried: string[], foundCategory: string}>}
 */
async function endemicArticles(countryName) {
  const seen = new Set();
  /** @type {string[]} */
  const titles = [];
  /** @type {string[]} */
  const tried = [];
  /** @param {string} t */
  const push = (t) => {
    if (seen.has(t) || NOT_A_SPECIES.test(t) || titles.length >= MAX_SPECIES) return;
    seen.add(t);
    titles.push(t);
  };
  /** @param {string} cat */
  const openSubcategories = async (cat) => {
    let subs;
    try {
      subs = await categoryMembers(cat, "subcat", 50);
    } catch {
      subs = [];
    }
    return subs;
  };
  /** @param {string[]} subs */
  const readSubcategories = async (subs) => {
    for (const sub of subs.slice(0, 24)) {
      if (titles.length >= MAX_SPECIES) break;
      try {
        (await categoryMembers(sub, "page", 200)).forEach(push);
      } catch {
        /* skip */
      }
    }
  };

  let foundCategory = "";
  for (const cat of categoryCandidates(countryName)) {
    // Once a spelling has answered, the others are only wasted requests.
    if (titles.length || foundCategory) break;
    let pages;
    try {
      pages = await categoryMembers(cat, "page", 500);
    } catch (e) {
      tried.push(`${cat.replace("Category:", "")} → ${cleanText(e && e.message, 30)}`);
      continue;
    }
    if (!pages.length) {
      // An empty category may still have subcategories worth opening.
      const subs = await openSubcategories(cat);
      if (!subs.length) {
        tried.push(`${cat.replace("Category:", "")} → nothing`);
        continue;
      }
      foundCategory = cat;
      await readSubcategories(subs);
      continue;
    }
    foundCategory = cat;
    pages.forEach(push);
    if (titles.length < 20) await readSubcategories(await openSubcategories(cat));
  }
  return { titles, tried, foundCategory };
}

/**
 * Each article's lead image. `pilicense=any` matters: the default quietly
 * omits images that are not freely licensed, which here would look like an
 * article simply having no picture.
 *
 * @param {string[]} titles
 * @param {string} homeCode
 * @returns {Promise<Taxon[]>}
 */
async function leadImages(titles, homeCode) {
  /** @type {Taxon[]} */
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    let data;
    try {
      data = await wikipedia({
        action: "query",
        prop: "pageimages",
        pilicense: "any",
        piprop: "name",
        titles: titles.slice(i, i + 50).join("|"),
      });
    } catch {
      continue;
    }
    const pages = data && data.query && data.query.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
      const title = cleanText(String((page && page.title) || ""), 120);
      const file = cleanText(String((page && page.pageimage) || ""), 160);
      if (!title || !file) continue;
      out.push({
        qid: "W" + (Number.isInteger(page.pageid) ? page.pageid : 0),
        fileTitle: "File:" + file.replace(/_/g, " "),
        name: title,
        home: homeCode,
        articleUrl: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
      });
    }
  }
  return out;
}

/**
 * @typedef {object} Endemics
 * @property {Taxon[]} taxa species with a lead image
 * @property {number} articles species articles found, with or without an image
 * @property {string} foundCategory the category that answered
 * @property {string[]} tried what didn't, for error messages
 */

/**
 * The endemic species of a country that have a lead image. Keeping the
 * article count apart from the photograph count is what lets the app say
 * which of the two is missing.
 *
 * @param {{name: string, code: string}} country
 * @returns {Promise<Endemics>}
 */
export async function endemicsOf(country) {
  const { titles, tried, foundCategory } = await endemicArticles(country.name);
  if (!titles.length) return { taxa: [], articles: 0, foundCategory, tried };
  const taxa = await leadImages(titles, country.code);
  return { taxa, articles: titles.length, foundCategory, tried };
}

/**
 * Commons metadata for each taxon's lead image. Taxa whose image is unusable
 * (not on Commons, not an image, not citable) are dropped.
 *
 * @param {Taxon[]} taxa
 * @returns {Promise<Species[]>}
 */
export async function photographs(taxa) {
  const byTitle = new Map(taxa.map((t) => [t.fileTitle, t]));
  const titles = [...byTitle.keys()];
  /** @type {Species[]} */
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    let data;
    try {
      data = await mediawiki({
        action: "query",
        prop: "imageinfo",
        titles: titles.slice(i, i + 50).join("|"),
        iiprop: "url|extmetadata|size|mime",
        iiurlwidth: String(THUMB_W),
      });
    } catch {
      continue;
    }
    const pages = data && data.query && data.query.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      if (typeof info.mime === "string" && !/^image\//.test(info.mime)) continue;
      const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
      if (!pageid) continue;
      const thumb = firstSafeImageUrl(info.thumburl, info.url);
      if (!thumb) continue;
      const taxon = byTitle.get(cleanText(String(page.title || ""), 160));
      if (!taxon) continue;
      const ex = info.extmetadata || {};
      /** @param {string} k */
      const val = (k) => {
        const f = own(ex, k);
        return f && typeof f.value === "string" ? f.value : "";
      };
      out.push({
        ...taxon,
        pageid,
        thumb,
        full: widenThumb(thumb, info.width, FULL_W) || thumb,
        author: htmlToText(val("Artist"), 70),
        licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
        describeUrl: commonsFileUrl(pageid),
        keywords: norm(taxon.name),
      });
    }
  }
  return out;
}
