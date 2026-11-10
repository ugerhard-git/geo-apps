/**
 * Cross-sections — the line across the country and the heights along it.
 *
 * Pure functions, so they can be tested without a browser:
 *   unwrapPolys      a country across the antimeridian, on one side of it
 *   insideIntervals  where a west–east or south–north line is inside the
 *                    country, found exactly from the border's edges
 *   middleOf         the country's middle, for "through the middle"
 *   samplePoints     evenly spaced points along the inside parts
 *   lineZoom, pointTileKeys  which tiles the points need
 *   readProfile      the heights at the points, as runs between the gaps
 *   gridPoints, highestPoint  a coarse search for the highest ground
 *   heightScale      the chart's height axis
 *
 * A line runs along one parallel ("west to east") or one meridian ("south
 * to north"), so it is a straight line on most maps and easy to describe.
 */

import { heightAtPx, lonLatPx, tileKey, TILE } from "../../shared/terrain-tiles.js";
import { clamp } from "../../shared/util.js";

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** "we": along a parallel, west to east; "sn": along a meridian, south to north. */
/** @typedef {"we" | "sn"} Direction */
/** @typedef {[number, number]} Interval start and end, in degrees along the line */

/**
 * @typedef {object} Sample
 * @property {number} lon
 * @property {number} lat
 * @property {number} km distance from the line's first point inside the country
 * @property {number} run which inside part of the line it belongs to
 */

/**
 * @typedef {object} Profile
 * @property {Array<Array<[number, number]>>} runs [km, metres] per inside part
 * @property {number} lengthKm from the first point inside to the last
 * @property {number} min lowest height read, metres
 * @property {number} max highest height read, metres
 * @property {number} missing points whose tile couldn't be loaded
 */

/** Kilometres per degree of latitude, and of longitude at the equator. */
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32;

/**
 * Kilometres per degree along a line.
 *
 * @param {Direction} dir
 * @param {number} value the line's latitude ("we") or longitude ("sn")
 */
export const kmPerDegree = (dir, value) =>
  dir === "we" ? KM_PER_DEG_LON * Math.cos((value * Math.PI) / 180) : KM_PER_DEG_LAT;

/**
 * A country that spans the antimeridian (Russia, Fiji, the USA's Aleutians)
 * moved onto one side of it: its western pieces get 360° added, so its
 * longitudes run on past 180° instead of jumping to −180°. Rings that cross
 * the line are unwrapped the same way. Other countries come back unchanged.
 *
 * @param {Polys} polys degrees
 * @returns {Polys}
 */
export function unwrapPolys(polys) {
  const jumps = (/** @type {Array<[number, number]>} */ ring) =>
    ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
  let east = false;
  let west = false;
  let crossing = false;
  for (const rings of polys)
    for (const ring of rings) {
      if (jumps(ring)) crossing = true;
      for (const [lon] of ring) {
        if (lon >= 179.5) east = true;
        if (lon <= -179.5) west = true;
      }
    }
  if (!crossing && !(east && west)) return polys;
  return polys.map((rings) =>
    rings.map((ring) => {
      const shift = jumps(ring) || ring.every(([lon]) => lon <= 0);
      return shift
        ? ring.map(
            ([lon, lat]) => /** @type {[number, number]} */ ([lon < 0 ? lon + 360 : lon, lat]),
          )
        : ring;
    }),
  );
}

/**
 * Where a line crosses one polygon's rings, as degrees along the line.
 *
 * @param {Array<Array<[number, number]>>} rings outer ring first, then holes
 * @param {Direction} dir
 * @param {number} value
 * @returns {number[]} sorted
 */
function crossingsOf(rings, dir, value) {
  // Along a parallel, edges are cut at a latitude and give longitudes; along
  // a meridian the other way round.
  const across = dir === "we" ? 1 : 0;
  const along = 1 - across;
  /** @type {number[]} */
  const out = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      // Half-open test, so a vertex exactly on the line counts once.
      if (a[across] > value !== b[across] > value) {
        const t = (value - a[across]) / (b[across] - a[across]);
        out.push(a[along] + t * (b[along] - a[along]));
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * The parts of a line that lie inside the country, merged across its
 * polygons and in order along the line. Holes (a lake, an enclave) count as
 * outside, by the even-odd rule.
 *
 * Pass shapes through {@link unwrapPolys} first, so a line across a country
 * that spans the antimeridian stays in one piece.
 *
 * @param {Polys} polys degrees
 * @param {Direction} dir
 * @param {number} value the line's latitude ("we") or longitude ("sn")
 * @returns {Interval[]}
 */
export function insideIntervals(polys, dir, value) {
  /** @type {Interval[]} */
  const parts = [];
  for (const rings of polys) {
    const xs = crossingsOf(rings, dir, value);
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1] > xs[i]) parts.push([xs[i], xs[i + 1]]);
  }
  parts.sort((a, b) => a[0] - b[0]);
  /** @type {Interval[]} */
  const merged = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && p[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], p[1]);
    else merged.push([p[0], p[1]]);
  }
  return merged;
}

/**
 * The middle of a country: the centre of its area (of the outer rings),
 * which is where a person would point. For a crescent-shaped country it can
 * lie outside; a line through it still crosses the country.
 *
 * @param {Polys} polys degrees
 * @returns {[number, number] | null} lon, lat
 */
export function middleOf(polys) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const [outer] of polys) {
    if (!outer || outer.length < 3) continue;
    // Around the ring's first point, so the numbers stay small.
    const [ox, oy] = outer[0];
    let a = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < outer.length; i++) {
      const x0 = outer[i][0] - ox;
      const y0 = outer[i][1] - oy;
      const x1 = outer[(i + 1) % outer.length][0] - ox;
      const y1 = outer[(i + 1) % outer.length][1] - oy;
      const cross = x0 * y1 - x1 * y0;
      a += cross;
      sx += (x0 + x1) * cross;
      sy += (y0 + y1) * cross;
    }
    if (a === 0) continue;
    // Each ring's own centre, weighted by its area whichever way it runs.
    const weight = Math.abs(a);
    area += weight;
    cx += (sx / (3 * a) + ox) * weight;
    cy += (sy / (3 * a) + oy) * weight;
  }
  if (area < 1e-12) return null;
  let lon = cx / area;
  if (lon > 180) lon -= 360;
  return [lon, cy / area];
}

/**
 * Evenly spaced points along the inside parts of the line. The distance in
 * km keeps the gaps, so a bay or a neighbour's land shows as a gap of the
 * right width.
 *
 * @param {Direction} dir
 * @param {number} value the line's latitude ("we") or longitude ("sn")
 * @param {Interval[]} parts from {@link insideIntervals}
 * @param {number} n about this many points in all
 * @returns {Sample[]}
 */
export function samplePoints(dir, value, parts, n) {
  if (!parts.length) return [];
  const inside = parts.reduce((s, [a, b]) => s + (b - a), 0);
  const kmDeg = kmPerDegree(dir, value);
  const start = parts[0][0];
  /** @type {Sample[]} */
  const out = [];
  parts.forEach(([a, b], run) => {
    // At least two points per part, so even a sliver of land is drawn.
    const count = Math.max(2, Math.round((n * (b - a)) / inside));
    for (let i = 0; i < count; i++) {
      const at = a + ((b - a) * i) / (count - 1);
      out.push({
        lon: dir === "we" ? at : value,
        lat: dir === "we" ? value : at,
        km: (at - start) * kmDeg,
        run,
      });
    }
  });
  return out;
}

/**
 * The zoom whose pixels are about as far apart as the points, so the
 * profile is as detailed as the points allow without fetching more than it
 * needs; and coarser while the line would need more than `maxTiles` tiles.
 *
 * @param {Sample[]} points
 * @param {number} maxZoom
 * @param {number} maxTiles
 */
export function lineZoom(points, maxZoom, maxTiles) {
  if (points.length < 2) return 0;
  const spacingKm = (points[points.length - 1].km - points[0].km) / (points.length - 1) || 1;
  const lat = points[Math.floor(points.length / 2)].lat;
  const worldKm = 40075 * Math.cos((lat * Math.PI) / 180);
  let z = clamp(Math.ceil(Math.log2(worldKm / (TILE * spacingKm))), 0, maxZoom);
  while (z > 0 && pointTileKeys(points, z).length > maxTiles) z--;
  return z;
}

/**
 * Every tile the points read from, with the neighbours a bilinear read
 * reaches into.
 *
 * @param {Sample[]} points
 * @param {number} z
 * @returns {string[]}
 */
export function pointTileKeys(points, z) {
  const keys = new Set();
  for (const p of points) {
    const [px, py] = lonLatPx(p.lon, p.lat, z);
    for (const dx of [-0.5, 0.5])
      for (const dy of [-0.5, 0.5]) {
        const ty = Math.floor((py + dy) / TILE);
        if (ty >= 0 && ty < 2 ** z) keys.add(tileKey(z, Math.floor((px + dx) / TILE), ty));
      }
  }
  return [...keys];
}

/**
 * The heights at the points, as one run of [km, metres] per inside part.
 * A point whose tile is missing ends its run, so a gap shows there rather
 * than a made-up line.
 *
 * @param {Sample[]} points
 * @param {number} z
 * @param {(key: string) => Float32Array | null | undefined} tileAt
 * @returns {Profile}
 */
export function readProfile(points, z, tileAt) {
  /** @type {Array<Array<[number, number]>>} */
  const runs = [];
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  /** @type {Array<[number, number]> | null} */
  let current = null;
  let lastRun = -1;
  for (const p of points) {
    const [px, py] = lonLatPx(p.lon, p.lat, z);
    const h = heightAtPx(px, py, z, tileAt);
    if (!Number.isFinite(h)) {
      missing++;
      current = null;
      continue;
    }
    if (!current || p.run !== lastRun) runs.push((current = []));
    lastRun = p.run;
    current.push([p.km, h]);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const lengthKm = points.length ? points[points.length - 1].km - points[0].km : 0;
  return {
    runs: runs.filter((r) => r.length >= 2),
    lengthKm,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    missing,
  };
}

/**
 * Points on a grid over the country, for finding its highest ground. Rows
 * are cut with {@link insideIntervals}, so only points inside are returned.
 *
 * @param {Polys} polys degrees
 * @param {{w: number, s: number, e: number, n: number}} box the country's bounds
 * @param {number} rows
 * @param {number} cols
 * @returns {Array<[number, number]>} lon, lat
 */
export function gridPoints(polys, box, rows, cols) {
  /** @type {Array<[number, number]>} */
  const out = [];
  const dx = (box.e - box.w) / cols;
  for (let r = 0; r < rows; r++) {
    const lat = box.s + ((box.n - box.s) * (r + 0.5)) / rows;
    for (const [a, b] of insideIntervals(polys, "we", lat)) {
      // Points on the grid's columns, plus the middle of a sliver too narrow for one.
      let any = false;
      for (let c = Math.ceil((a - box.w) / dx - 0.5); box.w + (c + 0.5) * dx <= b; c++) {
        const lon = box.w + (c + 0.5) * dx;
        if (lon >= a) {
          out.push([lon > 180 ? lon - 360 : lon, lat]);
          any = true;
        }
      }
      if (!any) out.push([(a + b) / 2 > 180 ? (a + b) / 2 - 360 : (a + b) / 2, lat]);
    }
  }
  return out;
}

/**
 * The highest of the points, read from the tiles.
 *
 * @param {Array<[number, number]>} points lon, lat
 * @param {number} z
 * @param {(key: string) => Float32Array | null | undefined} tileAt
 * @returns {[number, number] | null} lon, lat
 */
export function highestPoint(points, z, tileAt) {
  let best = -Infinity;
  /** @type {[number, number] | null} */
  let at = null;
  for (const [lon, lat] of points) {
    const [px, py] = lonLatPx(lon, lat, z);
    const h = heightAtPx(px, py, z, tileAt);
    if (h > best) {
      best = h;
      at = [lon, lat];
    }
  }
  return at;
}

/**
 * @typedef {object} Scale
 * @property {number} bottom metres at the chart's floor
 * @property {number} top metres at the chart's top
 * @property {number} step metres between grid lines
 */

/** Grid steps to choose from, in metres. */
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

/**
 * The chart's height axis.
 *
 * By default every country shares the same scale, from sea level to
 * `top` metres (higher only if the line crosses higher ground), so a flat
 * country looks flat. Land well below sea level (the Dead Sea, the Caspian
 * shore) pushes the floor down; a few metres (Dutch polders) don't.
 *
 * Stretched, the axis fits the line's own heights, to show small hills.
 *
 * @param {number} min lowest height on the line
 * @param {number} max highest
 * @param {boolean} stretch fit the heights rather than share the scale
 * @param {number} top the shared scale's top, metres
 * @returns {Scale}
 */
export function heightScale(min, max, stretch, top) {
  if (!stretch) {
    const step = 1000;
    const hi = Math.max(top, Math.ceil(max / step) * step);
    const lo = min < -20 ? Math.floor(min / 100) * 100 : 0;
    return { bottom: lo, top: hi, step: lo < 0 && hi <= 2000 ? 100 : step };
  }
  const lo = Math.min(0, min);
  const span = Math.max(10, max - lo);
  // About five grid lines.
  const step = STEPS.find((s) => span / s <= 6) || 5000;
  return {
    bottom: Math.floor(lo / step) * step,
    top: Math.max(step, Math.ceil(max / step) * step),
    step,
  };
}
