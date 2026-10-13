/**
 * Wikimedia Commons: the API, image URLs, and licences.
 *
 * Used by the apps that put Commons images on a sheet (currency, endemics,
 * plates, road signs, flag colours).
 *
 * @module shared/commons
 */

import { httpError } from "./net.js";
import { cleanText } from "./text.js";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** The only host images are ever loaded from. Each app's CSP allows just this one. */
export const UPLOAD_HOST = "upload.wikimedia.org";

/**
 * Call a MediaWiki action API (Commons by default) and return the parsed reply.
 * `format=json`, `formatversion=2` and anonymous CORS (`origin=*`) are added.
 *
 * @param {Record<string, string>} params
 * @param {string} [api=COMMONS_API] another wiki's `api.php`, e.g. English Wikipedia's
 * @returns {Promise<any>}
 * @throws on an HTTP error, or when the API reports an error
 */
export async function mediawiki(params, api = COMMONS_API) {
  const p = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const r = await fetch(api + "?" + p.toString());
  if (!r.ok) throw httpError(r.status);
  const data = await r.json();
  if (data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}

/**
 * The page titles in a `list=categorymembers` reply. The shape is checked
 * rather than assumed: a malformed reply gives nothing, not a type error from
 * deep inside a loop.
 *
 * @param {any} data
 * @returns {string[]}
 */
export function memberTitles(data) {
  const rows = data && data.query && data.query.categorymembers;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (r && typeof r.title === "string" ? r.title : "")).filter(Boolean);
}

/**
 * Subcategories of a Commons category.
 *
 * @param {string} title e.g. `"Category:License plates by country"`
 * @param {number} [limit=500]
 * @returns {Promise<string[]>}
 */
export async function subcategoriesOf(title, limit) {
  const data = await mediawiki({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmtype: "subcat",
    cmlimit: String(limit || 500),
  });
  return memberTitles(data);
}

/**
 * Files directly inside a Commons category.
 *
 * @param {string} title
 * @param {number} [limit=500]
 * @returns {Promise<string[]>}
 */
export async function filesIn(title, limit) {
  const data = await mediawiki({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmtype: "file",
    cmlimit: String(limit || 500),
  });
  return memberTitles(data);
}

/**
 * Accept a URL only if it is HTTPS on Wikimedia's upload host.
 *
 * A protocol-relative "//upload.wikimedia.org/..." (as rendered wiki HTML
 * uses) has no scheme, so parsing it without a base would throw and look like
 * a wrong host; it is resolved against the upload host instead.
 *
 * @param {unknown} u
 * @returns {string | null} the normalised URL, or `null`
 */
export function safeImageUrl(u) {
  const raw = String(u || "");
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://" + UPLOAD_HOST + "/");
    if (url.protocol !== "https:" || url.hostname !== UPLOAD_HOST) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The first candidate that passes {@link safeImageUrl}. Each one is tried in
 * turn, so an unusable thumbnail URL doesn't lose a file whose full-size URL is
 * perfectly good.
 *
 * @param {...unknown} candidates
 * @returns {string | null}
 */
export function firstSafeImageUrl(...candidates) {
  for (const c of candidates) {
    const ok = safeImageUrl(c);
    if (ok) return ok;
  }
  return null;
}

/**
 * Ask MediaWiki for a wider render of the same thumbnail, never an upscale.
 * Thumbnail URLs carry their width (`/320px-Name.png`), so a wider one can be
 * requested without downloading the multi-megabyte original.
 *
 * @param {string} thumburl
 * @param {number} naturalWidth the original's width; renders never exceed it
 * @param {number} maxWidth the widest render wanted
 * @returns {string | null} `null` when no wider render is available
 */
export function widenThumb(thumburl, naturalWidth, maxWidth) {
  const m = /\/(\d+)px-([^/]+)$/.exec(thumburl);
  if (!m) return null;
  const have = parseInt(m[1], 10);
  const cap = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : maxWidth;
  const target = Math.min(maxWidth, cap);
  if (!Number.isFinite(target) || target <= have) return null;
  return safeImageUrl(thumburl.replace(/\/\d+px-([^/]+)$/, `/${Math.round(target)}px-$1`));
}

/**
 * @typedef {object} Licence
 * @property {"pd" | "by" | "sa" | "unknown"} id
 * @property {string} label the licence's short name as Commons gives it
 * @property {boolean} attribution whether the author must be credited
 * @property {boolean} shareAlike whether derived works must use the same licence
 */

/**
 * Classify a Commons licence from its short name and URL.
 *
 * Anything not recognisable is treated as the strictest case rather than the
 * most permissive, so an unparsed licence can never slip into an export as
 * though it were public domain.
 *
 * @param {string} short `LicenseShortName` from `extmetadata`
 * @param {unknown} urlRaw `LicenseUrl` from `extmetadata`
 * @returns {Licence}
 */
export function classifyLicence(short, urlRaw) {
  const s = (short || "").toLowerCase();
  const u = String(urlRaw || "").toLowerCase();
  const label = short || "Licence not stated";

  if (/publicdomain\/zero|\/cc0\//.test(u) || /\bcc0\b|public domain|pd-|no restrictions/.test(s))
    return { id: "pd", label, attribution: false, shareAlike: false };
  if (/\/by-sa\//.test(u) || /by-sa|share.?alike|gfdl/.test(s))
    return { id: "sa", label, attribution: true, shareAlike: true };
  if (/\/by\//.test(u) || /^cc by\b|attribution/.test(s))
    return { id: "by", label, attribution: true, shareAlike: false };
  return { id: "unknown", label, attribution: true, shareAlike: true };
}

/**
 * Whether a file passes the "Licences to offer" filter.
 *
 * @param {string} mode `"all"`, `"open"` (PD, CC0 and CC BY) or `"pd"`
 * @param {{ licence: Licence }} rec
 * @returns {boolean}
 */
export function licenceAllows(mode, rec) {
  if (mode === "all") return true;
  if (mode === "pd") return rec.licence.id === "pd";
  return rec.licence.id === "pd" || rec.licence.id === "by";
}

/**
 * The CSS class for a licence badge in a picker tile.
 *
 * @param {Licence} licence
 * @returns {"pd" | "by" | "sa"}
 */
export const licenceClass = (licence) =>
  licence.id === "pd" ? "pd" : licence.id === "by" ? "by" : "sa";

/**
 * The file title in a `Special:FilePath` URL, as Wikidata gives image values:
 * "https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Germany.svg"
 * → "File:Flag of Germany.svg".
 *
 * @param {unknown} u
 * @returns {string} the title, or "" when `u` is not such a URL
 */
export function fileTitleFromFilePath(u) {
  const s = String(u || "");
  const m = /Special:FilePath\/(.+)$/.exec(s);
  if (!m) return "";
  let name;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    name = m[1];
  }
  name = cleanText(name.replace(/_/g, " "), 160);
  return name ? "File:" + name : "";
}

/**
 * A permanent link to a Commons file page, built from its page id.
 *
 * @param {number} pageid
 * @returns {string}
 */
export const commonsFileUrl = (pageid) =>
  `https://commons.wikimedia.org/w/index.php?curid=${pageid}`;
