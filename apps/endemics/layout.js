/**
 * Endemic animals — laying photographs out without cropping them.
 *
 * "Justified rows", as photo galleries do it: photographs keep their own
 * aspect ratio, every photograph in a row shares the row's height, and each
 * one's width follows from its shape. A row of a portrait and two landscape
 * shots therefore fits together without cutting anything off or adding bars.
 *
 * The order of the photographs is kept; what varies is where the rows break.
 * Every possible set of breaks is tried (2^5 = 32 for the 6-photo limit in
 * config.js) and the one that shows the photographs largest — and most
 * evenly — wins.
 *
 * Pure: no DOM. Unit tests in tests/unit/apps.test.js.
 */

/**
 * @typedef {object} Placed
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h photo height (labels go underneath, in `extraPerRow`)
 */

/**
 * @param {number[]} aspects width / height of each photograph, in order
 * @param {object} box
 * @param {number} box.x
 * @param {number} box.y
 * @param {number} box.w
 * @param {number} box.h
 * @param {number} gap between photographs, and between rows
 * @param {number} extraPerRow height under every row for its labels
 * @returns {Placed[]} one entry per photograph, in the same order; empty if
 *   nothing fits
 */
export function justifiedRows(aspects, box, gap, extraPerRow) {
  const n = aspects.length;
  if (!n || box.w <= 0 || box.h <= 0) return [];
  const a = aspects.map((v) => (Number.isFinite(v) && v > 0 ? v : 1));

  /** @type {{score: number, rows: number[][], s: number, heights: number[]} | null} */
  let best = null;
  // Each bit of `mask` says whether a row ends after that photograph.
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    /** @type {number[][]} */
    const rows = [[]];
    for (let i = 0; i < n; i++) {
      rows[rows.length - 1].push(i);
      if (i < n - 1 && mask & (1 << i)) rows.push([]);
    }
    // At full width, a row's height is whatever makes its photographs fill it.
    const heights = rows.map(
      (r) => (box.w - gap * (r.length - 1)) / r.reduce((sum, i) => sum + a[i], 0),
    );
    if (heights.some((h) => h <= 0)) continue;
    const fixed = rows.length * extraPerRow + gap * (rows.length - 1);
    const photosH = heights.reduce((sum, h) => sum + h, 0);
    // Too tall? Shrink every row by the same factor (the rows get narrower).
    const s = Math.min(1, (box.h - fixed) / photosH);
    if (s <= 0) continue;
    // Prefer large and even photographs: sum of each one's linear size.
    let score = 0;
    rows.forEach((r, k) => {
      for (const i of r) score += Math.sqrt(a[i]) * heights[k] * s;
    });
    if (!best || score > best.score) best = { score, rows, s, heights };
  }
  if (!best) return [];

  const { rows, s, heights } = best;
  const totalH =
    heights.reduce((sum, h) => sum + h * s, 0) +
    rows.length * extraPerRow +
    gap * (rows.length - 1);
  let y = box.y + Math.max(0, (box.h - totalH) / 2);
  /** @type {Placed[]} */
  const out = new Array(n);
  rows.forEach((r, k) => {
    const h = heights[k] * s;
    const rowW = r.reduce((sum, i) => sum + a[i] * h, 0) + gap * (r.length - 1);
    let x = box.x + (box.w - rowW) / 2;
    for (const i of r) {
      const w = a[i] * h;
      out[i] = { x, y, w, h };
      x += w + gap;
    }
    y += h + extraPerRow + gap;
  });
  return out;
}
