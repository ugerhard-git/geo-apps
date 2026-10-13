/**
 * Outlines — projecting shapes, keeping the mainland, and turning them.
 *
 * Pure functions on arrays of coordinates.
 */

import { MAINLAND_OVERRIDE, decimate, distKm, inBox, mainlandSet } from "../../shared/geo.js";
import { clamp, own } from "../../shared/util.js";
import { MERCATOR_LIMIT } from "./config.js";

/** @typedef {import("./shapes.js").Polys} Polys */
/** @typedef {import("../../shared/geo.js").Point} Point */

/**
 * Web Mercator, in radians.
 *
 * @param {number} lon
 * @param {number} lat
 * @returns {Point}
 */
function mercator(lon, lat) {
  const la = (clamp(lat, -MERCATOR_LIMIT, MERCATOR_LIMIT) * Math.PI) / 180;
  return [(lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + la / 2))];
}

/**
 * Shoelace area of a ring, in its own units.
 *
 * @param {Point[]} ring
 */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/**
 * Ground area in km², not projected area. Measuring after Mercator would make
 * Alaska look bigger than the lower 48 and let it win the "main landmass" test.
 *
 * @param {Point[]} ring in degrees
 */
function groundArea(ring) {
  const mlat = ((ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI) / 180;
  return ringArea(ring) * Math.cos(mlat) * 111.32 * 110.57;
}

/**
 * Everything the mainland test needs about each polygon: ground area, a
 * centre, a radius for cheap rejection, and a thinned outline.
 *
 * @param {Polys} polys
 */
function describePolys(polys) {
  return polys
    .map((rings) => {
      const outer = rings[0];
      const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
      const cy = outer.reduce((s, p) => s + p[1], 0) / outer.length;
      /** @type {Point} */
      const centroid = [cx, cy];
      const pts = decimate(outer, 40);
      const radius = pts.reduce((m, p) => Math.max(m, distKm(p, centroid)), 0);
      return { rings, area: groundArea(outer), centroid, pts, radius };
    })
    .sort((a, b) => b.area - a.area);
}

/**
 * The landmasses that count as the mainland: by name where nearness
 * misleads, otherwise the largest and everything within reach of it.
 *
 * @param {Polys} polys
 * @param {string} name the country's Natural Earth name
 * @returns {Polys}
 */
export function mainlandPolys(polys, name) {
  const described = describePolys(polys);
  if (!described.length) return [];
  const box = own(MAINLAND_OVERRIDE, name);
  if (box) {
    const kept = described.filter((p) => inBox(p.centroid, box));
    return (kept.length ? kept : [described[0]]).map((p) => p.rings);
  }
  const set = mainlandSet(described);
  return described.filter((_, i) => set.has(i)).map((p) => p.rings);
}

/**
 * Project a subject to plane coordinates. A polygon spanning the antimeridian
 * is shifted east rather than drawn as a band across the whole world.
 *
 * @param {Polys} polys in degrees
 * @param {boolean} mainOnly keep only the mainland
 * @param {string} name the country's Natural Earth name
 * @returns {Polys}
 */
export function projectSubject(polys, mainOnly, name) {
  const use = mainOnly ? mainlandPolys(polys, name) : polys;
  return use
    .map((rings) =>
      rings.map((ring) => {
        let wrap = false;
        for (let i = 1; i < ring.length; i++) {
          if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
            wrap = true;
            break;
          }
        }
        return ring.map(([lon, lat]) => mercator(wrap && lon < 0 ? lon + 360 : lon, lat));
      }),
    )
    .filter((rings) => rings.length);
}

/**
 * @param {Polys} polys
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null}
 */
export function boundsOf(polys) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const rings of polys)
    for (const ring of rings)
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * Turn about a centre, mirror, and hand back a fresh set of points. Rotating
 * before fitting means the outline fills the frame at any angle rather than
 * shrinking into a corner.
 *
 * @param {Polys} polys
 * @param {number} deg
 * @param {boolean} flipH
 * @param {boolean} flipV
 * @param {{x0: number, y0: number, x1: number, y1: number} | null} [about] the
 *   box to turn about. It must be given when regions are turned with their
 *   country: spinning each one about its own middle leaves them in place
 *   while the country rotates beneath them.
 * @returns {Polys}
 */
export function transformPolys(polys, deg, flipH, flipV, about) {
  const b = about || boundsOf(polys);
  if (!b) return polys;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const a = ((deg % 360) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  return polys.map((rings) =>
    rings.map((ring) =>
      ring.map(([x, y]) => {
        const dx = (x - cx) * sx;
        const dy = (y - cy) * sy;
        return /** @type {Point} */ ([cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);
      }),
    ),
  );
}
