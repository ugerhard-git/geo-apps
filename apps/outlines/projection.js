/**
 * Outlines — turning and mirroring shapes. Projection, the mainland test and
 * bounds live in shared/projection.js and are re-exported here.
 *
 * Pure functions on arrays of coordinates.
 */

import { boundsOf } from "../../shared/projection.js";

export { boundsOf, mainlandPolys, projectSubject } from "../../shared/projection.js";

/** @typedef {import("./shapes.js").Polys} Polys */
/** @typedef {import("../../shared/geo.js").Point} Point */

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
