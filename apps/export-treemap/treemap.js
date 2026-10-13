/**
 * Export treemaps — the squarified treemap layout (Bruls, Huizing & van Wijk,
 * 2000): rectangles whose areas are proportional to their values, kept as
 * close to square as possible.
 *
 * Pure functions, with unit tests in tests/unit/export-treemap.test.js.
 */

/**
 * @template T
 * @typedef {object} Tile
 * @property {{node: T, area: number}} n
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * The worst aspect ratio in a row of areas laid along a side.
 *
 * @param {number[]} areas
 * @param {number} side
 * @returns {number}
 */
function worst(areas, side) {
  if (!areas.length) return Infinity;
  let sum = 0;
  let mx = -Infinity;
  let mn = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > mx) mx = a;
    if (a < mn) mn = a;
  }
  if (sum <= 0 || mn <= 0) return Infinity;
  const s2 = sum * sum;
  const l2 = side * side;
  return Math.max((l2 * mx) / s2, s2 / (l2 * mn));
}

/**
 * Lay a row out along the shorter side and return what space is left.
 *
 * @template T
 * @param {Array<{node: T, area: number}>} row
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {{rects: Tile<T>[], rest: {x: number, y: number, w: number, h: number}}}
 */
function placeRow(row, x, y, w, h) {
  const sum = row.reduce((s, n) => s + n.area, 0);
  /** @type {Tile<T>[]} */
  const rects = [];
  if (sum <= 0 || w <= 0 || h <= 0) return { rects, rest: { x, y, w, h } };
  if (w >= h) {
    // Stack the row as a column on the left.
    const rw = sum / h;
    let cy = y;
    for (const n of row) {
      const rh = n.area / rw;
      rects.push({ n, x, y: cy, w: rw, h: rh });
      cy += rh;
    }
    return { rects, rest: { x: x + rw, y, w: Math.max(0, w - rw), h } };
  }
  // Otherwise a strip across the top.
  const rh = sum / w;
  let cx = x;
  for (const n of row) {
    const rw = n.area / rh;
    rects.push({ n, x: cx, y, w: rw, h: rh });
    cx += rw;
  }
  return { rects, rest: { x, y: y + rh, w, h: Math.max(0, h - rh) } };
}

/**
 * Lay `nodes` out in the box `(x, y, w, h)`, biggest first.
 *
 * @template {{value: number}} T
 * @param {T[]} nodes
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Tile<T>[]} one tile per node with a positive value
 */
export function squarify(nodes, x, y, w, h) {
  /** @type {Tile<T>[]} */
  const out = [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const queue = nodes
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((n) => ({ node: n, area: (n.value / total) * w * h }));
  /** @type {Array<{node: T, area: number}>} */
  let row = [];
  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0];
    const a = row.map((n) => n.area);
    if (!row.length || worst(a, side) >= worst(a.concat(next.area), side)) {
      row.push(/** @type {{node: T, area: number}} */ (queue.shift()));
    } else {
      const res = placeRow(row, x, y, w, h);
      out.push(...res.rects);
      ({ x, y, w, h } = res.rest);
      row = [];
    }
  }
  if (row.length) out.push(...placeRow(row, x, y, w, h).rects);
  return out;
}
