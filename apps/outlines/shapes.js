/**
 * Outlines — loading shapes: countries from Natural Earth (TopoJSON) and
 * their first-level regions from geoBoundaries (GeoJSON), fetched on demand.
 *
 * Everything is validated on the way through: a malformed arc index or a
 * name that is not a string drops the shape rather than the page.
 */

import { decodeArcs, isNum } from "../../shared/geo.js";
import { URL_COUNTRY_CODES, parseCsv } from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import { ALLOWED_DATA_HOSTS, GEOB_API, REGION_HOSTS } from "./config.js";

/** @typedef {import("../../shared/geo.js").Point} Point */
/** @typedef {Point[][][]} Polys polygons, each a list of rings (outer first) */

/**
 * @typedef {object} CountryShape
 * @property {string} name Natural Earth name, e.g. "United States of America"
 * @property {string} id ISO numeric code, e.g. "840"
 * @property {Polys} polys
 */

/**
 * @typedef {object} Region
 * @property {string} name
 * @property {Polys} polys
 */

/* ═══════════════════════════════════════════════════════════
   Countries, from TopoJSON
   ═══════════════════════════════════════════════════════════ */

/**
 * Join a ring's arcs end to end; a negative index means "traverse backwards".
 *
 * @param {Point[][]} arcs
 * @param {unknown[]} indices
 * @returns {Point[] | null} `null` when an index is invalid or the ring is too short
 */
function ringFrom(arcs, indices) {
  /** @type {Point[]} */
  const ring = [];
  for (const idx of indices) {
    if (!Number.isInteger(idx)) return null;
    const n = /** @type {number} */ (idx);
    const arc = arcs[n < 0 ? ~n : n];
    if (!arc) return null;
    const part = n < 0 ? arc.slice().reverse() : arc;
    for (let k = ring.length ? 1 : 0; k < part.length; k++) ring.push(part[k]);
  }
  return ring.length >= 4 ? ring : null;
}

/**
 * Every country in a world-atlas topology.
 *
 * @param {any} topo
 * @returns {CountryShape[]} sorted by name
 */
export function topoCountries(topo) {
  if (!topo || typeof topo !== "object") throw new Error("not an object");
  if (!Array.isArray(topo.arcs)) throw new Error("no arcs");
  const coll = topo.objects && topo.objects.countries;
  if (!coll || !Array.isArray(coll.geometries)) throw new Error("no countries");
  const arcs = decodeArcs(topo);
  /** @type {CountryShape[]} */
  const out = [];
  for (const g of coll.geometries) {
    const name = cleanText(g && g.properties && g.properties.name, 80);
    if (!name) continue;
    // The numeric ISO code, which the region files are reached through.
    const id = cleanText(g && g.id, 8);
    /** @type {Polys} */
    const polys = [];
    const groups = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    for (const rings of groups) {
      if (!Array.isArray(rings)) continue;
      const built = [];
      for (const r of rings) {
        if (!Array.isArray(r)) continue;
        const ring = ringFrom(arcs, r);
        if (ring) built.push(ring);
      }
      if (built.length) polys.push(built);
    }
    if (polys.length) out.push({ name, id, polys });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ═══════════════════════════════════════════════════════════
   Country codes: the outlines carry the numeric code, geoBoundaries the alpha-3
   ═══════════════════════════════════════════════════════════ */

/**
 * Read the bytes and decode them as UTF-8 rather than letting the response
 * decide. GitHub serves Git LFS objects as a binary type, and text() then
 * falls back to a one-byte encoding, which turns "Región de Antofagasta" into
 * "RegiÃ³n de Antofagasta".
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readUtf8(response) {
  const buf = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

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

/** @returns {Promise<Map<string, string>>} alpha-3 by numeric code */
async function loadCodes() {
  if (iso3ByNumeric) return iso3ByNumeric;
  const r = await fetch(URL_COUNTRY_CODES);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const rows = parseCsv(await readUtf8(r));
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
 * @returns {Promise<any>} the parsed GeoJSON
 * @throws an Error (with `soft: true` when geoBoundaries simply has no file)
 */
async function fetchRegionFile(iso3) {
  let data = null;
  let missing = false;
  /** @type {string[]} */
  const tried = [];
  for (const build of REGION_HOSTS) {
    const url = build(iso3);
    const host = url.split("/")[2];
    let r;
    try {
      r = await fetch(url);
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
    const text = await readUtf8(r);
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
      const meta = await fetch(GEOB_API(iso3));
      if (meta.ok) {
        const info = await meta.json();
        const rec = Array.isArray(info) ? info[0] : info;
        const candidate = safeDataUrl(rec && (rec.simplifiedGeometryGeoJSON || rec.gjDownloadURL));
        if (candidate) {
          const r2 = await fetch(candidate);
          const t2 = r2.ok ? await readUtf8(r2) : "";
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
 * @returns {Promise<{iso3: string, regions: Region[]}>} regions sorted by name
 * @throws an Error, with `soft: true` when there is simply no file to fetch
 */
export async function loadRegionsFor(country) {
  await loadCodes();
  const iso3 = iso3For(country);
  if (!iso3) {
    const e = /** @type {Error & {soft: boolean}} */ (new Error("no ISO code for this country"));
    e.soft = true;
    throw e;
  }
  const data = await fetchRegionFile(iso3);
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
