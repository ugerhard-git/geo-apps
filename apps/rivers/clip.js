/**
 * Rivers — keeping the parts of rivers that belong to a country.
 *
 * A river is cut into runs of points that lie inside the country or within
 * a few kilometres of its border. A run that enters the country is kept; a
 * run that only follows the border is kept when it is long, because then it
 * is a border river rather than a neighbour's river passing close by.
 *
 * Everything is in Web Mercator plane coordinates. Mercator is conformal, so
 * a distance on the ground maps to the same plane distance in every
 * direction at a point: ground km × cosh(y) / 6371.
 *
 * Testing every river point against every border edge would be slow for
 * large countries, so the border's edges are indexed: by horizontal band
 * for the inside test, and by grid cell for the distance test.
 *
 * Pure — no DOM — so it can be unit-tested.
 */

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/projection.js").Box} Box */
/** @typedef {import("./data.js").Line} Line */

const EARTH_KM = 6371;

/** Plane distance for a ground distance at plane latitude `y`. */
export const planeDist = (/** @type {number} */ km, /** @type {number} */ y) =>
  (km / EARTH_KM) * Math.cosh(y);

/** Ground distance for a plane distance at plane latitude `y`. */
export const groundKm = (/** @type {number} */ d, /** @type {number} */ y) =>
  (d / Math.cosh(y)) * EARTH_KM;

/**
 * Squared distance from a point to a segment.
 *
 * @param {number} px @param {number} py
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * A country's border, indexed for "is this point inside?" and "is it within
 * `km` of the border?".
 */
export class Region {
  /**
   * @param {Polys} shape the country in plane coordinates
   * @param {number} km how far outside the border still counts
   */
  constructor(shape, km) {
    this.km = km;
    /** @type {number[]} edges as ax, ay, bx, by */
    const edges = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const rings of shape)
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const [ax, ay] = ring[i];
          const [bx, by] = ring[(i + 1) % ring.length];
          if (ax === bx && ay === by) continue;
          edges.push(ax, ay, bx, by);
          x0 = Math.min(x0, ax);
          x1 = Math.max(x1, ax);
          y0 = Math.min(y0, ay);
          y1 = Math.max(y1, ay);
        }
    this.edges = Float64Array.from(edges);
    this.empty = !edges.length;
    // The widest the tolerance gets anywhere in the country.
    const tolMax = planeDist(km, Math.max(Math.abs(y0), Math.abs(y1)) || 0);
    this.tolMax = tolMax;
    /** @type {Box} */
    this.box = { x0: x0 - tolMax, y0: y0 - tolMax, x1: x1 + tolMax, y1: y1 + tolMax };
    if (this.empty) return;

    // Horizontal bands, for ray casting.
    const nEdges = this.edges.length / 4;
    this.bands = Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(nEdges) * 2)));
    this.bandH = (y1 - y0) / this.bands || 1;
    this.by0 = y0;
    /** @type {number[][]} */
    this.band = Array.from({ length: this.bands }, () => []);
    // A square grid over the tolerance box, for the distance test.
    const b = this.box;
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    this.cells = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(nEdges))));
    this.cell = Math.max(span / this.cells, tolMax);
    this.cols = Math.ceil((b.x1 - b.x0) / this.cell) + 1;
    this.rows = Math.ceil((b.y1 - b.y0) / this.cell) + 1;
    /** @type {Map<number, number[]>} */
    this.grid = new Map();

    for (let e = 0; e < nEdges; e++) {
      const ax = this.edges[e * 4];
      const ay = this.edges[e * 4 + 1];
      const bx = this.edges[e * 4 + 2];
      const by = this.edges[e * 4 + 3];
      const lo = this.bandOf(Math.min(ay, by));
      const hi = this.bandOf(Math.max(ay, by));
      for (let k = lo; k <= hi; k++) this.band[k].push(e);
      const c0 = this.colOf(Math.min(ax, bx) - tolMax);
      const c1 = this.colOf(Math.max(ax, bx) + tolMax);
      const r0 = this.rowOf(Math.min(ay, by) - tolMax);
      const r1 = this.rowOf(Math.max(ay, by) + tolMax);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const key = r * this.cols + c;
          const list = this.grid.get(key);
          if (list) list.push(e);
          else this.grid.set(key, [e]);
        }
    }
  }

  /** @param {number} y */
  bandOf(y) {
    return Math.max(0, Math.min(this.bands - 1, Math.floor((y - this.by0) / this.bandH)));
  }
  /** @param {number} x */
  colOf(x) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.box.x0) / this.cell)));
  }
  /** @param {number} y */
  rowOf(y) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.box.y0) / this.cell)));
  }

  /**
   * Inside the country (even-odd, so lakes cut out of it count as outside).
   *
   * @param {number} x
   * @param {number} y
   */
  inside(x, y) {
    if (this.empty || y < this.by0 || y > this.by0 + this.bands * this.bandH) return false;
    const E = this.edges;
    let inside = false;
    for (const e of this.band[this.bandOf(y)]) {
      const ay = E[e * 4 + 1];
      const by = E[e * 4 + 3];
      if (ay > y === by > y) continue;
      const ax = E[e * 4];
      const bx = E[e * 4 + 2];
      if (x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }

  /**
   * Within `km` of the border.
   *
   * @param {number} x
   * @param {number} y
   */
  near(x, y) {
    const b = this.box;
    if (this.empty || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
    const list = this.grid.get(this.rowOf(y) * this.cols + this.colOf(x));
    if (!list) return false;
    const tol = planeDist(this.km, y);
    const tol2 = tol * tol;
    const E = this.edges;
    for (const e of list)
      if (segDist2(x, y, E[e * 4], E[e * 4 + 1], E[e * 4 + 2], E[e * 4 + 3]) <= tol2) return true;
    return false;
  }
}

/**
 * @typedef {object} Piece
 * @property {number[]} xy plane coordinates, interleaved
 * @property {number} rank
 * @property {Line["kind"]} kind
 */

/**
 * Cut a line into the pieces that belong to the region.
 *
 * @param {Float64Array} xy plane coordinates, interleaved
 * @param {number} shift added to every x (2π to move a line round the antimeridian)
 * @param {Region} region
 * @param {number} borderRunKm shortest border-only run that is kept
 * @returns {number[][]} the pieces, as interleaved coordinates
 */
export function clipPath(xy, shift, region, borderRunKm) {
  /** @type {number[][]} */
  const out = [];
  /** @type {number[]} */
  let run = [];
  let entered = false;
  let km = 0;
  const flush = () => {
    if (run.length >= 4 && (entered || km >= borderRunKm)) out.push(run);
    run = [];
    entered = false;
    km = 0;
  };
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i] + shift;
    const y = xy[i + 1];
    const isIn = region.inside(x, y);
    if (isIn || region.near(x, y)) {
      if (run.length) {
        const px = run[run.length - 2];
        const py = run[run.length - 1];
        km += groundKm(Math.hypot(x - px, y - py), (y + py) / 2);
      }
      run.push(x, y);
      if (isIn) entered = true;
    } else flush();
  }
  flush();
  return out;
}

/**
 * Everything of `lines` that belongs to the region.
 *
 * @param {Line[]} lines
 * @param {Region} region
 * @param {number} borderRunKm
 * @returns {Piece[]}
 */
export function clipLines(lines, region, borderRunKm) {
  /** @type {Piece[]} */
  const out = [];
  if (region.empty) return out;
  const b = region.box;
  const TWO_PI = 2 * Math.PI;
  for (const line of lines) {
    // A line west of the antimeridian may belong with a country moved east of it.
    let shift = 0;
    const lb = line.box;
    const overlaps = (/** @type {number} */ s) =>
      lb.x1 + s >= b.x0 && lb.x0 + s <= b.x1 && lb.y1 >= b.y0 && lb.y0 <= b.y1;
    if (!overlaps(0)) {
      if (b.x1 > Math.PI && overlaps(TWO_PI)) shift = TWO_PI;
      else continue;
    }
    for (const xy of clipPath(line.xy, shift, region, borderRunKm))
      out.push({ xy, rank: line.rank, kind: line.kind });
  }
  return out;
}
