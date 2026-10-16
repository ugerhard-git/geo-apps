/**
 * Country statistics — laying up to six charts out on the sheet.
 */

import { frameSpec } from "../../shared/sheet.js";
import { drawChart, fitText } from "./charts.js";
import { STATS } from "./config.js";

/**
 * @typedef {import("./charts.js").ChartOptions & {
 *   bg: string,
 *   transparent: boolean,
 *   country: boolean,
 *   caption: string,
 *   capTop: boolean,
 * }} SheetOptions
 */

/**
 * @typedef {object} SheetContent
 * @property {{name: string} | null} country
 * @property {string[]} selected statistic ids, in the order chosen
 * @property {Map<string, import("./series.js").Series | null>} available
 * @property {Map<string, Set<string>>} hiddenNames per statistic, the labels shown as "?"
 */

/**
 * The grid for `n` charts: the number of columns that gives each chart the
 * most room, judged as a box about 1.4 times as wide as it is tall (a pie
 * with its legend beside it). A last row with fewer charts shares its width
 * among them. So one chart fills the sheet, two sit side by side on a wide
 * sheet, four make a two-by-two grid and six three-by-two.
 *
 * @param {number} n
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Array<[number, number, number, number]>} `[x, y, w, h]` per chart
 */
export function chartBoxes(n, x, y, w, h) {
  if (n <= 1) return [[x, y, w, h]];
  const gap = Math.min(w, h) * 0.06;
  let best = { cols: 1, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    const score = Math.min(cw / 1.4, ch);
    if (score > best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const ch = (h - gap * (rows - 1)) / rows;
  /** @type {Array<[number, number, number, number]>} */
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const cw = (w - gap * (inRow - 1)) / inRow;
    for (let c = 0; c < inRow; c++) boxes.push([x + c * (cw + gap), y + r * (ch + gap), cw, ch]);
  }
  return boxes;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, { country, selected, available, hiddenNames }) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad;
  let bottom = H - pad;

  // Caption: sized to fit with the Inter metrics, then set in Source Serif.
  if (opts.caption) {
    const capPx = Math.round(H * 0.045);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = fitText(ctx, opts.caption, W - pad * 2, capPx, 600);
    ctx.font = `600 ${size}px "Source Serif 4", Georgia, serif`;
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + size * 0.6);
      top += size * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - size * 0.6);
      bottom -= size * 1.9;
    }
  }

  // The country's name, along the bottom.
  if (opts.country && country) {
    const px = Math.round(H * 0.03);
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  const drawable = selected.filter((id) => available.get(id));
  if (!drawable.length) return;
  const boxes = chartBoxes(drawable.length, pad, top, W - pad * 2, bottom - top);
  drawable.forEach((id, i) => {
    const stat = STATS.find((s) => s.id === id);
    const series = available.get(id);
    const [bx, by, bw, bh] = boxes[i];
    if (stat && series)
      drawChart(ctx, stat, withHidden(series, hiddenNames.get(id)), bx, by, bw, bh, opts);
  });
}

/**
 * The series with its hidden names marked, for drawing.
 *
 * @param {import("./series.js").Series} series
 * @param {Set<string> | undefined} names
 * @returns {import("./series.js").Series}
 */
function withHidden(series, names) {
  if (!names?.size) return series;
  return {
    ...series,
    slices: series.slices.map((s) => ({ ...s, hideName: names.has(s.label) })),
  };
}
