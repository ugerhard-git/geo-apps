/**
 * Flag colours — finding a country's flag.
 *
 * Wikidata says which file is a country's flag, so the filename is never
 * guessed at. Commons then renders that file to a PNG of a chosen width,
 * which keeps the flag's official proportions — Switzerland square, Qatar
 * very wide — and avoids drawing SVG to a canvas at all.
 */

import { fileTitleFromFilePath, mediawiki, safeImageUrl } from "../../shared/commons.js";
import { WDQS, getJson } from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { SAMPLE_WIDTH } from "./config.js";

const ISO2 = /^[A-Z]{2}$/;

/**
 * @param {string} iso2 already checked against {@link ISO2}, so safe to embed
 * @returns {string}
 */
function flagQuery(iso2) {
  return `SELECT ?flag WHERE {
  ?country wdt:P297 "${iso2}" .
  ?country wdt:P41 ?flag .
}
LIMIT 4`;
}

/**
 * The Commons file Wikidata records as the country's flag.
 *
 * @param {string} iso2
 * @returns {Promise<string>} e.g. "File:Flag of Germany.svg", or ""
 */
export async function flagFileFor(iso2) {
  if (!ISO2.test(iso2)) return "";
  const url = WDQS + "?format=json&query=" + encodeURIComponent(flagQuery(iso2));
  const data = await getJson(url);
  const rows = (data && data.results && data.results.bindings) || [];
  for (const row of rows) {
    const title = fileTitleFromFilePath(row.flag && row.flag.value);
    if (title) return title;
  }
  return "";
}

/**
 * @typedef {object} FlagRendering
 * @property {string} src PNG rendering on the upload host
 * @property {number} width rendering size
 * @property {number} height
 * @property {number} fullWidth the file's own size
 * @property {number} fullHeight
 * @property {string} licence
 * @property {number} pageid
 * @property {string} title
 */

/**
 * Ask Commons for a PNG rendering of the flag file.
 *
 * @param {string} fileTitle
 * @returns {Promise<FlagRendering | null>}
 */
export async function flagRendering(fileTitle) {
  const data = await mediawiki({
    action: "query",
    prop: "imageinfo",
    titles: fileTitle,
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(SAMPLE_WIDTH),
  });
  const pages = data && data.query && data.query.pages;
  const page = Array.isArray(pages) ? pages[0] : null;
  const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!info) return null;
  // The thumbnail is a PNG rendered by Commons at the file's own aspect
  // ratio, which is exactly what makes the percentages mean anything.
  const src = safeImageUrl(info.thumburl) || safeImageUrl(info.url);
  if (!src) return null;
  const ex = info.extmetadata || {};
  /** @param {string} k */
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };
  return {
    src,
    width: Number.isFinite(info.thumbwidth) ? info.thumbwidth : 0,
    height: Number.isFinite(info.thumbheight) ? info.thumbheight : 0,
    fullWidth: Number.isFinite(info.width) ? info.width : 0,
    fullHeight: Number.isFinite(info.height) ? info.height : 0,
    licence: cleanText(val("LicenseShortName").replace(/<[^>]*>/g, " "), 40),
    pageid: Number.isInteger(page.pageid) ? page.pageid : 0,
    title: cleanText(String(page.title || ""), 160),
  };
}

/**
 * Load the rendering with CORS, so its pixels can be read.
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadFlagImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("the flag image wouldn't load"));
    img.src = url;
  });
}
