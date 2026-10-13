/**
 * Road signs — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { blurAll, toCanvas } from "../../shared/blur.js";
import { drawImageGrid } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp, own } from "../../shared/util.js";
import { SECTION_LABEL, SECTION_ORDER } from "./config.js";

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent leave the background empty
 * @property {boolean} sections label each sign class
 * @property {boolean} country print the country's name (reveals the answer)
 * @property {boolean} blur blur the signs, to hide their wording
 * @property {number} blurAmount blur strength, in tenths of a percent of the sign's width
 * @property {string} caption
 * @property {boolean} capTop caption above (true) or below (false)
 */

/**
 * @typedef {object} SheetContent
 * @property {import("./commons-data.js").Country | null} country
 * @property {import("./commons-data.js").Sign[]} signs in the order chosen
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * A sign as it will be drawn: the image at its natural size, blurred when
 * asked to be.
 *
 * @param {HTMLImageElement} img
 * @param {SheetOptions} opts
 * @returns {HTMLCanvasElement}
 */
function renderSign(img, opts) {
  const base = toCanvas(img);
  const radius = (opts.blurAmount / 1000) * base.width;
  if (!opts.blur || radius <= 0.5) return base;

  // Blur reads from a separate copy: a canvas drawn onto itself through a
  // filter is read while it is being written, and only part of it comes out.
  const out = document.createElement("canvas");
  out.width = base.width;
  out.height = base.height;
  blurAll(out, base, radius);
  return out;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export async function drawSheet(canvas, opts, { country, signs, loadImage }) {
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

  // Caption: shrunk until it fits the width.
  if (opts.caption) {
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let px = Math.round(H * 0.045);
    ctx.font = `600 ${px}px "Barlow Condensed", sans-serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Barlow Condensed", sans-serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  // The country's name, along the bottom.
  if (opts.country && country) {
    const px = Math.round(H * 0.03);
    ctx.font = `500 ${px}px "Barlow", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.standard || country.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  // One horizontal band per sign class that has anything chosen.
  const groups = SECTION_ORDER.map((id) => ({
    id,
    items: signs.filter((s) => s.section === id),
  })).filter((g) => g.items.length);
  if (!groups.length) return;

  /** @type {Map<import("./commons-data.js").Sign, HTMLCanvasElement>} */
  const prepared = new Map();
  for (const rec of groups.flatMap((g) => g.items)) {
    let img;
    try {
      img = await loadImage(rec.full);
    } catch {
      try {
        img = await loadImage(rec.thumb); // the wider render is unavailable
      } catch {
        continue;
      }
    }
    prepared.set(rec, renderSign(img, opts));
  }

  const bandH = (bottom - top) / groups.length;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const items = g.items.filter((r) => prepared.has(r));
    if (!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    if (opts.sections) {
      const hPx = clamp(Math.round(bandH * 0.14), 15, 46);
      ctx.font = `600 ${hPx}px "Barlow Condensed", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText((own(SECTION_LABEL, g.id) || "Signs").toUpperCase(), pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7;
    }
    drawImageGrid(ctx, items, prepared, pad, y, W - pad * 2, bandTop + bandH - y - bandH * 0.05, {
      creditColour: opts.at,
      creditFont: '"Barlow", sans-serif',
      maxCreditPx: 18,
    });
  }
}
