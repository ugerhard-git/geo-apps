/**
 * Country shapes from world-atlas (Natural Earth, public domain), shared by
 * the map-based apps. Everything is validated on the way through: a malformed
 * arc index or a name that is not a string drops the shape rather than the
 * page.
 *
 * @module shared/world
 */

import { decodeArcs, isNum } from "./geo.js";
import { cleanText } from "./text.js";

/** @typedef {import("./geo.js").Point} Point */
/** @typedef {Point[][][]} Polys polygons, each a list of rings (outer first) */

/**
 * @typedef {object} CountryShape
 * @property {string} name Natural Earth name, e.g. "United States of America"
 * @property {string} id ISO numeric code, e.g. "840"
 * @property {Polys} polys
 */

/** Country outlines at 1:50m, a good balance of detail and download size. */
export const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";

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

/**
 * Whether a point lies inside a set of polygons (even-odd rule, so holes
 * count as outside).
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Polys} polys in degrees
 * @returns {boolean}
 */
export function pointInPolys(lon, lat, polys) {
  for (const rings of polys) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Bounding box of polygons, in degrees.
 *
 * @param {Polys} polys
 * @returns {{w: number, s: number, e: number, n: number} | null}
 */
export function boxOfPolys(polys) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const rings of polys)
    for (const ring of rings)
      for (const [x, y] of ring) {
        if (!isNum(x) || !isNum(y)) continue;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
  return Number.isFinite(w) ? { w, s, e, n } : null;
}
