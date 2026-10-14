/**
 * Rivers — reading Natural Earth's river and lake files.
 *
 * The files come from a CDN and are treated as untrusted: only the geometry
 * and two attributes (scale rank and feature class) are read, every
 * coordinate is checked, and the size of a file is capped. Names are never
 * read, so nothing from these files can reach the page as text.
 *
 * Coordinates are projected to Web Mercator once, on load, so picking a
 * country only has to compare boxes.
 *
 * Pure — no DOM, no network — so it can be unit-tested.
 */

import { mercator } from "../../shared/projection.js";
import { MAX_FEATURES, MAX_POINTS } from "./config.js";

/** @typedef {import("../../shared/projection.js").Box} Box */

/**
 * @typedef {object} Line
 * @property {Float64Array} xy plane coordinates, x and y interleaved
 * @property {Box} box
 * @property {number} rank Natural Earth scale rank: 0 for the greatest rivers, 12 for the smallest
 * @property {"river" | "intermittent" | "lake"} kind "lake" is a centre-line through a lake
 */

/**
 * @typedef {object} Lake
 * @property {Float64Array[]} rings plane coordinates, x and y interleaved (outer ring first)
 * @property {Box} box
 */

/** @param {unknown} v */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Project a GeoJSON coordinate list, or return null if any point is invalid.
 *
 * @param {unknown} coords
 * @param {{points: number}} budget points still allowed in this file
 * @returns {Float64Array | null}
 */
function projectPath(coords, budget) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  budget.points -= coords.length;
  if (budget.points < 0) throw new Error("too many points");
  const out = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i];
    if (!Array.isArray(p)) return null;
    const lon = p[0];
    const lat = p[1];
    if (!isNum(lon) || !isNum(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    const [x, y] = mercator(lon, lat);
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

/**
 * @param {Float64Array[]} paths
 * @returns {Box}
 */
function boxOf(paths) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const xy of paths)
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < x0) x0 = xy[i];
      if (xy[i] > x1) x1 = xy[i];
      if (xy[i + 1] < y0) y0 = xy[i + 1];
      if (xy[i + 1] > y1) y1 = xy[i + 1];
    }
  return { x0, y0, x1, y1 };
}

/**
 * The features of a GeoJSON FeatureCollection, checked for shape and size.
 *
 * @param {any} geojson
 * @returns {any[]}
 */
function featuresOf(geojson) {
  const fs = geojson && geojson.type === "FeatureCollection" && geojson.features;
  if (!Array.isArray(fs)) throw new Error("not a GeoJSON feature collection");
  if (fs.length > MAX_FEATURES) throw new Error("too many features");
  return fs;
}

/**
 * @param {unknown} featurecla
 * @returns {Line["kind"]}
 */
function kindOf(featurecla) {
  const c = typeof featurecla === "string" ? featurecla.toLowerCase() : "";
  if (c.includes("lake")) return "lake";
  if (c.includes("intermittent")) return "intermittent";
  return "river";
}

/**
 * Read a river file. Each part of a MultiLineString becomes its own line.
 *
 * @param {any} geojson
 * @returns {Line[]}
 * @throws when the file is not a feature collection or is far too large
 */
export function parseRivers(geojson) {
  const budget = { points: MAX_POINTS };
  /** @type {Line[]} */
  const out = [];
  for (const f of featuresOf(geojson)) {
    const g = f && f.geometry;
    if (!g || !Array.isArray(g.coordinates)) continue; // some features have no geometry
    const parts =
      g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    const props = (f && f.properties) || {};
    const rank = isNum(props.scalerank) ? Math.max(0, Math.min(12, props.scalerank)) : 12;
    const kind = kindOf(props.featurecla);
    for (const part of parts) {
      const xy = projectPath(part, budget);
      if (xy) out.push({ xy, box: boxOf([xy]), rank, kind });
    }
  }
  return out;
}

/**
 * Read a lake file. Each polygon of a MultiPolygon becomes its own lake.
 *
 * @param {any} geojson
 * @returns {Lake[]}
 * @throws when the file is not a feature collection or is far too large
 */
export function parseLakes(geojson) {
  const budget = { points: MAX_POINTS };
  /** @type {Lake[]} */
  const out = [];
  for (const f of featuresOf(geojson)) {
    const g = f && f.geometry;
    if (!g || !Array.isArray(g.coordinates)) continue;
    const polys =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      if (!Array.isArray(poly)) continue;
      /** @type {Float64Array[]} */
      const rings = [];
      for (const ring of poly) {
        const xy = projectPath(ring, budget);
        if (xy && xy.length >= 8) rings.push(xy);
        else if (!rings.length) break; // without its outer ring, a lake's holes mean nothing
      }
      if (rings.length) out.push({ rings, box: boxOf(rings) });
    }
  }
  return out;
}
