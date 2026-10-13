/**
 * Country statistics — laying up to four charts out on the sheet.
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
 */

/**
 * One chart fills the page; two split the long side; three is two over one;
 * four is a grid.
 *
 * @param {number} n
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Array<[number, number, number, number]>} `[x, y, w, h]` per chart
 */
function chartBoxes(n, x, y, w, h) {
  const gap = Math.min(w, h) * 0.06;
  if (n <= 1) return [[x, y, w, h]];
  if (n === 2) {
    if (w >= h) {
      const cw = (w - gap) / 2;
      return [
        [x, y, cw, h],
        [x + cw + gap, y, cw, h],
      ];
    }
    const ch = (h - gap) / 2;
    return [
      [x, y, w, ch],
      [x, y + ch + gap, w, ch],
    ];
  }
  const cw = (w - gap) / 2;
  const ch = (h - gap) / 2;
  /** @type {Array<[number, number, number, number]>} */
  const grid = [
    [x, y, cw, ch],
    [x + cw + gap, y, cw, ch],
    [x, y + ch + gap, cw, ch],
    [x + cw + gap, y + ch + gap, cw, ch],
  ];
  if (n === 3) return [grid[0], grid[1], [x, y + ch + gap, w, ch]];
  return grid;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, { country, selected, available }) {
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
    if (stat && series) drawChart(ctx, stat, series, bx, by, bw, bh, opts);
  });
}
