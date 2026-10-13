/**
 * Flag colours — counting a flag's pixels and grouping them into colours.
 *
 * `quantise` is pure and has unit tests in tests/unit/flagcolours.test.js.
 */

import { clamp } from "../../shared/util.js";
import { ALPHA_FLOOR } from "./config.js";

/**
 * @typedef {object} Histogram
 * @property {Map<number, number>} counts pixel count per 0xRRGGBB value
 * @property {number} opaque pixels counted
 * @property {number} clear transparent pixels left out
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Slice one colour of the flag
 * @property {string} colour "#rrggbb"
 * @property {number[]} rgb
 * @property {number} count pixels
 * @property {number} share of the opaque pixels, 0–1
 */

/**
 * @typedef {object} QuantiseOptions
 * @property {boolean} fold fold detail colours into the nearest main colour
 * @property {number} threshold smallest share that makes a colour, as a fraction
 * @property {number} maxSlices most colours to return
 */

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} "#rrggbb"
 */
export const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");

/** @param {number} key 0xRRGGBB */
const unpack = (key) => [(key >> 16) & 255, (key >> 8) & 255, key & 255];

/**
 * Squared distance between two colours in RGB space.
 *
 * @param {number[]} a
 * @param {number[]} b
 */
const dist2 = (a, b) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/**
 * Every pixel of an image, counted exactly. Anti-aliasing means a two-colour
 * flag still produces thousands of distinct values along its edges, so the raw
 * histogram is a starting point rather than an answer.
 *
 * @param {HTMLImageElement} img
 * @returns {Histogram}
 * @throws an Error with `tainted: true` when the browser won't let the page
 *   read the pixels
 */
export function histogram(img) {
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (
    canvas.getContext("2d", { willReadFrequently: true })
  );
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    const err = /** @type {Error & {tainted: boolean}} */ (
      new Error("this browser wouldn't let the page read the flag's pixels")
    );
    err.tainted = true;
    throw err;
  }
  /** @type {Map<number, number>} */
  const counts = new Map();
  let opaque = 0;
  let clear = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_FLOOR) {
      clear++; // Nepal, and soft edges
      continue;
    }
    opaque++;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, opaque, clear, width: w, height: h };
}

/**
 * The colours a person would say the flag is.
 *
 * Anything above the threshold anchors a slice; everything else joins
 * whichever anchor it is closest to, which is what turns a million
 * anti-aliased edge pixels back into two stripes. With folding off, colours
 * that are distinct enough to be their own thing — an emblem's gold, say —
 * keep their own slice.
 *
 * @param {Pick<Histogram, "counts" | "opaque">} hist
 * @param {QuantiseOptions} opts
 * @returns {Slice[]} largest first
 */
export function quantise(hist, opts) {
  const total = hist.opaque;
  if (!total) return [];
  const entries = [...hist.counts.entries()].sort((a, b) => b[1] - a[1]);
  const minShare = opts.threshold; // a fraction, not a percent
  const anchorFloor = Math.max(1, Math.floor(total * minShare));
  /** @type {Array<{rgb: number[], key: number, count: number}>} */
  const anchors = [];
  for (const [key, n] of entries) {
    if (anchors.length >= opts.maxSlices) break;
    if (n < anchorFloor) break;
    const rgb = unpack(key);
    // Two anchors this close are the same colour with different rounding.
    if (anchors.some((a) => dist2(a.rgb, rgb) < 200)) continue;
    anchors.push({ rgb, key, count: 0 });
  }
  // A flag whose colours all fall below the threshold still has colours.
  if (!anchors.length && entries.length) {
    const rgb = unpack(entries[0][0]);
    anchors.push({ rgb, key: entries[0][0], count: 0 });
  }
  const extras = [];
  const detailFloor = Math.max(1, Math.floor(total * minShare * 0.12));
  for (const [key, n] of entries) {
    const rgb = unpack(key);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = dist2(anchors[i].rgb, rgb);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Far from every anchor, big enough to matter, and the user wants detail:
    // this is emblem colour rather than an anti-aliased edge.
    if (
      !opts.fold &&
      bestD > 2600 &&
      n >= detailFloor &&
      extras.length + anchors.length < opts.maxSlices
    ) {
      extras.push({ rgb, key, count: n });
      continue;
    }
    anchors[best].count += n;
  }
  return [...anchors, ...extras]
    .filter((s) => s.count > 0)
    .map((s) => ({
      colour: hex(s.rgb[0], s.rgb[1], s.rgb[2]),
      rgb: s.rgb,
      count: s.count,
      share: s.count / total,
    }))
    .sort((a, b) => b.share - a.share);
}
