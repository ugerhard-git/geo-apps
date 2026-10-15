/**
 * Outlines — loading shapes: countries from Natural Earth (TopoJSON) and
 * their first-level regions from geoBoundaries (GeoJSON), fetched on demand.
 *
 * Everything is validated on the way through: a malformed arc index or a
 * name that is not a string drops the shape rather than the page.
 */

import { isNum } from "../../shared/geo.js";
import {
  URL_COUNTRY_CODES,
  URL_COUNTRY_CODES_GITHUB,
  fetchTextWithin,
  parseCsv,
} from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import {
  ALLOWED_DATA_HOSTS,
  CODES_TIMEOUT_MS,
  GEOB_API,
  REGION_HOSTS,
  REGION_TIMEOUT_MS,
} from "./config.js";

/** @typedef {import("../../shared/geo.js").Point} Point */
/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/world.js").CountryShape} CountryShape */

// Countries come from shared/world.js; re-exported for this app's main.js.
export { topoCountries } from "../../shared/world.js";

/**
 * @typedef {object} Region
 * @property {string} name
 * @property {Polys} polys
 */

/* ═══════════════════════════════════════════════════════════
   Countries, from TopoJSON
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Country codes: the outlines carry the numeric code, geoBoundaries the alpha-3
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<string, string> | null} */
let iso3ByNumeric = null;

/*
  Numeric to alpha-3, from a published crosswalk rather than from memory, and
  spot-checked so a silently wrong table cannot send one country's regions
  out under another's name.
*/
const CODE_SPOT_CHECK = [
  ["276", "DEU"],
  ["404", "KEN"],
  ["840", "USA"],
  ["250", "FRA"],
];

/** @type {Promise<Map<string, string>> | null} the table being fetched, shared by concurrent callers */
let codesLoading = null;

/** @returns {Promise<Map<string, string>>} alpha-3 by numeric code */
function loadCodes() {
  if (iso3ByNumeric) return Promise.resolve(iso3ByNumeric);
  if (!codesLoading)
    codesLoading = fetchCodes().finally(() => {
      codesLoading = null;
    });
  return codesLoading;
}

/**
 * The code table from jsDelivr, or from GitHub if jsDelivr fails or is slow.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function fetchCodes() {
  /** @type {string[]} */
  const tried = [];
  let text = "";
  for (const url of [URL_COUNTRY_CODES, URL_COUNTRY_CODES_GITHUB]) {
    try {
      const r = await fetchTextWithin(url, CODES_TIMEOUT_MS);
      if (r.ok) {
        text = r.text;
        break;
      }
      tried.push(`${url.split("/")[2]} → HTTP ${r.status}`);
    } catch (e) {
      tried.push(`${url.split("/")[2]} → ${cleanText(e && e.message, 40)}`);
    }
  }
  if (!text) throw new Error("couldn't get the country-code table — " + tried.join("; "));
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("the code table was empty");
  const head = rows[0].map((h) => cleanText(h, 60).toLowerCase());
  /** @param {string[]} names */
  const findCol = (names) => head.findIndex((h) => names.some((n) => h === n));
  const iNum = findCol(["iso3166-1-numeric", "iso3166-1-numeric-code", "m49", "un m49"]);
  const iA3 = findCol(["iso3166-1-alpha-3", "iso3166-1-alpha3"]);
  if (iNum < 0 || iA3 < 0) throw new Error("no numeric/alpha-3 columns");
  /** @type {Map<string, string>} */
  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length <= Math.max(iNum, iA3)) continue;
    const num = cleanText(row[iNum], 4).replace(/\D/g, "");
    const a3 = cleanText(row[iA3], 4).toUpperCase();
    if (!num || !/^[A-Z]{3}$/.test(a3)) continue;
    map.set(String(parseInt(num, 10)), a3);
  }
  const wrong = CODE_SPOT_CHECK.filter(([n, a]) => map.get(String(parseInt(n, 10))) !== a);
  if (wrong.length)
    throw new Error("the code table failed its check on " + wrong.map((w) => w[1]).join(", "));
  iso3ByNumeric = map;
  return map;
}

/**
 * A country's alpha-3 code, once the code table has loaded.
 *
 * @param {CountryShape | null} country
 * @returns {string} "" when unknown
 */
export function iso3For(country) {
  if (!iso3ByNumeric || !country || !country.id) return "";
  return iso3ByNumeric.get(String(parseInt(country.id, 10))) || "";
}

/* ═══════════════════════════════════════════════════════════
   Regions, from geoBoundaries
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {unknown} u
 * @returns {string | null}
 */
function safeDataUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && ALLOWED_DATA_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * "version https://git-lfs.github.com/spec/v1" — a stand-in, not the data.
 *
 * @param {string} text
 */
const isLfsPointer = (text) => /^\s*version https:\/\/git-lfs\./.test(String(text).slice(0, 80));

/**
 * @param {any} geometry a GeoJSON geometry
 * @returns {Polys}
 */
function regionPolys(geometry) {
  if (!geometry) return [];
  const groups =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  /** @type {Polys} */
  const out = [];
  for (const rings of groups) {
    if (!Array.isArray(rings)) continue;
    const built = [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const pts = ring.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
      if (pts.length >= 4) built.push(pts);
    }
    if (built.length) out.push(built);
  }
  return out;
}

/**
 * Fetch the geoBoundaries ADM1 file, trying each host and then asking
 * geoBoundaries' API where it is.
 *
 * @param {string} iso3
 * @param {(host: string) => void} onTry told which host is being asked
 * @returns {Promise<any>} the parsed GeoJSON
 * @throws an Error (with `soft: true` when geoBoundaries simply has no file)
 */
async function fetchRegionFile(iso3, onTry) {
  let data = null;
  let missing = false;
  /** @type {string[]} */
  const tried = [];
  for (const build of REGION_HOSTS) {
    const url = build(iso3);
    const host = url.split("/")[2];
    onTry(host);
    let r;
    try {
      r = await fetchTextWithin(url, REGION_TIMEOUT_MS);
    } catch (e) {
      tried.push(`${host} → ${cleanText(e && e.message, 30)}`);
      continue;
    }
    if (r.status === 404) {
      missing = true;
      tried.push(`${host} → not found`);
      continue;
    }
    if (!r.ok) {
      tried.push(`${host} → HTTP ${r.status}`);
      continue;
    }
    const text = r.text;
    // A pointer parses as neither JSON nor anything useful; say what it is.
    if (isLfsPointer(text)) {
      tried.push(`${host} → returned a Git LFS pointer, not the data`);
      continue;
    }
    try {
      data = JSON.parse(text);
    } catch {
      tried.push(`${host} → not JSON`);
      continue;
    }
    if (data && Array.isArray(data.features)) break;
    tried.push(`${host} → no features`);
    data = null;
  }

  // Last resort: ask geoBoundaries where the file is rather than assuming.
  if (!data) {
    try {
      onTry("geoboundaries.org");
      const meta = await fetchTextWithin(GEOB_API(iso3), REGION_TIMEOUT_MS);
      if (meta.ok) {
        const info = JSON.parse(meta.text);
        const rec = Array.isArray(info) ? info[0] : info;
        const candidate = safeDataUrl(rec && (rec.simplifiedGeometryGeoJSON || rec.gjDownloadURL));
        if (candidate) {
          const r2 = await fetchTextWithin(candidate, REGION_TIMEOUT_MS);
          const t2 = r2.ok ? r2.text : "";
          if (t2 && !isLfsPointer(t2)) {
            try {
              const parsed = JSON.parse(t2);
              if (parsed && Array.isArray(parsed.features)) data = parsed;
            } catch {
              tried.push("the address geoBoundaries gave → not JSON");
            }
          } else if (t2) tried.push("the address geoBoundaries gave → a Git LFS pointer too");
          else tried.push("the address geoBoundaries gave → HTTP " + r2.status);
        } else tried.push("geoBoundaries named a download host this page may not reach");
      } else tried.push("geoboundaries.org → HTTP " + meta.status);
    } catch (e) {
      tried.push("geoboundaries.org → " + cleanText(e && e.message, 30));
    }
  }

  if (!data) {
    const soft = missing && tried.every((t) => /not found/.test(t));
    const e = /** @type {Error & {soft: boolean}} */ (
      new Error(
        soft
          ? "geoBoundaries has no ADM1 file for " + iso3
          : "couldn't get the regions for " + iso3 + " — " + tried.join("; "),
      )
    );
    e.soft = soft;
    throw e;
  }
  return data;
}

/**
 * One country's first-level divisions.
 *
 * @param {CountryShape} country
 * @param {(host: string) => void} [onTry] told which host is being asked
 * @returns {Promise<{iso3: string, regions: Region[]}>} regions sorted by name
 * @throws an Error, with `soft: true` when there is simply no file to fetch
 */
export async function loadRegionsFor(country, onTry = () => {}) {
  await loadCodes();
  const iso3 = iso3For(country);
  if (!iso3) {
    const e = /** @type {Error & {soft: boolean}} */ (new Error("no ISO code for this country"));
    e.soft = true;
    throw e;
  }
  const data = await fetchRegionFile(iso3, onTry);
  /** @type {Region[]} */
  const out = [];
  for (const f of data.features) {
    const pr = (f && f.properties) || {};
    const name = cleanText(pr.shapeName || pr.shapeISO || pr.name || "", 80);
    if (!name) continue;
    const polys = regionPolys(f && f.geometry);
    if (!polys.length) continue;
    out.push({ name, polys });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { iso3, regions: out };
}
