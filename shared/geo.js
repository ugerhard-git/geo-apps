/**
 * Geography helpers shared by the apps that draw country shapes (outlines,
 * geo imagery): TopoJSON decoding, rough distances, and deciding which
 * landmasses count as a country's "mainland".
 *
 * Coordinates are `[longitude, latitude]` in degrees unless noted.
 *
 * @module shared/geo
 */

/** @typedef {[number, number]} Point */

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Decode a TopoJSON topology's arcs into absolute coordinates.
 *
 * Quantised topologies (with a `transform`) store each point as a delta from
 * the previous one; others store absolute positions. Malformed points are
 * skipped and a malformed arc becomes empty, so bad data drops a shape rather
 * than the page. Done here rather than by loading topojson-client from a CDN:
 * a third-party script would run with full access to the page, which is a
 * much larger thing to trust than ~20 lines of decoding.
 *
 * @param {{arcs: unknown[], transform?: {scale: number[], translate: number[]}}} topo
 * @returns {Point[][]}
 */
export function decodeArcs(topo) {
  const t = topo.transform;
  const sx = t ? t.scale[0] : 1;
  const sy = t ? t.scale[1] : 1;
  const tx = t ? t.translate[0] : 0;
  const ty = t ? t.translate[1] : 0;
  return topo.arcs.map((arc) => {
    /** @type {Point[]} */
    const out = [];
    if (!Array.isArray(arc)) return out;
    let x = 0;
    let y = 0;
    for (const pt of arc) {
      if (!Array.isArray(pt) || !isNum(pt[0]) || !isNum(pt[1])) continue;
      if (t) {
        x += pt[0];
        y += pt[1];
      } else {
        x = pt[0];
        y = pt[1];
      }
      out.push([x * sx + tx, y * sy + ty]);
    }
    return out;
  });
}

/**
 * Rough ground distance in km, good enough for clustering islands.
 *
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function distKm(a, b) {
  const mlat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (a[0] - b[0]) * Math.cos(mlat) * 111.32;
  const dy = (a[1] - b[1]) * 110.57;
  return Math.hypot(dx, dy);
}

/**
 * Reduce a ring to at most `n` evenly spaced points, so distance tests stay
 * cheap.
 *
 * @template T
 * @param {T[]} ring
 * @param {number} n
 * @returns {T[]}
 */
export function decimate(ring, n) {
  if (ring.length <= n) return ring;
  const step = ring.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(ring[Math.floor(i * step)]);
  return out;
}

/** Islands within this many km of the main landmass stay with it. */
export const CLUSTER_KM = 400;

/**
 * Countries where nearness alone gives the wrong answer. Corsica is close
 * enough to France to belong, French Guiana is not; Alaska is far from the
 * lower 48 but larger than most countries, so an area rule keeps it. These
 * boxes say what "the mainland" means. Keyed by the Natural Earth name.
 *
 * @type {Record<string, {lon: [number, number], lat: [number, number]}>}
 */
export const MAINLAND_OVERRIDE = {
  Norway: { lon: [4.5, 31.2], lat: [57.9, 71.2] }, // drop Svalbard & Jan Mayen
  Russia: { lon: [19.6, 180], lat: [41.2, 77.8] }, // clip at the dateline
  Fiji: { lon: [176.8, 182], lat: [-19.2, -16.1] }, // crosses the dateline
  Kiribati: { lon: [172.9, 210], lat: [-11.5, 4.7] },
  "New Zealand": { lon: [166.4, 178.6], lat: [-47.3, -34.4] },
  France: { lon: [-5.2, 9.6], lat: [41.3, 51.1] },
  Netherlands: { lon: [3.3, 7.3], lat: [50.7, 53.6] },
  "United States of America": { lon: [-125, -66.9], lat: [24.4, 49.4] },
  Chile: { lon: [-75.7, -66.4], lat: [-56.0, -17.5] },
  Ecuador: { lon: [-81.1, -75.2], lat: [-5.0, 1.5] },
  Portugal: { lon: [-9.6, -6.1], lat: [36.9, 42.2] },
  Spain: { lon: [-9.4, 4.4], lat: [35.9, 43.8] },
  Denmark: { lon: [8.0, 15.2], lat: [54.5, 57.8] },
  Yemen: { lon: [42.5, 54.6], lat: [12.1, 19.0] },
};

/**
 * Whether a point lies in a mainland box. Boxes that run past the
 * antimeridian (longitudes above 180) shift western longitudes east.
 *
 * @param {Point} centroid
 * @param {{lon: [number, number], lat: [number, number]}} box
 * @returns {boolean}
 */
export function inBox(centroid, box) {
  let lon = centroid[0];
  if (box.lon[1] > 180 && lon < 0) lon += 360; // boxes that run past the seam
  return (
    lon >= box.lon[0] && lon <= box.lon[1] && centroid[1] >= box.lat[0] && centroid[1] <= box.lat[1]
  );
}

/**
 * @typedef {object} Landmass what the mainland test needs to know about one polygon
 * @property {Point} centroid
 * @property {number} radius km from the centroid to the furthest sampled point
 * @property {Point[]} pts a thinned outline
 */

/**
 * The shortest distance between two landmasses, in km. A cheap disc test
 * comes first: if the discs around each can't come close, the point-by-point
 * test is skipped. Archipelagos depend on this.
 *
 * @param {Landmass} a
 * @param {Landmass} b
 * @returns {number}
 */
export function minPolyDist(a, b) {
  const gap = distKm(a.centroid, b.centroid) - a.radius - b.radius;
  if (gap > CLUSTER_KM) return gap;
  let best = Infinity;
  for (const p of a.pts)
    for (const q of b.pts) {
      const d = distKm(p, q);
      if (d < best) best = d;
    }
  return best;
}

/**
 * Which landmasses count as "the mainland": start from the largest (index 0,
 * so sort by area first), then keep absorbing anything within
 * {@link CLUSTER_KM} of what's already in. Chaining is what keeps Indonesia
 * and the Philippines whole while leaving Hawaii, Svalbard and the Canaries out.
 *
 * @param {Landmass[]} landmasses largest first
 * @returns {Set<number>} indices into `landmasses`
 */
export function mainlandSet(landmasses) {
  const inSet = new Set([0]);
  const frontier = [0];
  const pending = new Set(landmasses.map((_, i) => i));
  pending.delete(0);
  while (frontier.length) {
    const i = /** @type {number} */ (frontier.pop());
    for (const j of [...pending]) {
      if (minPolyDist(landmasses[i], landmasses[j]) <= CLUSTER_KM) {
        pending.delete(j);
        inSet.add(j);
        frontier.push(j);
      }
    }
  }
  return inSet;
}
