/**
 * Road signs — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { blurAll, toCanvas } from "../../shared/blur.js";
import { drawPhotos } from "../../shared/photo-sheet.js";
import { frameSpec } from "../../shared/sheet.js";

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent leave the background empty
 * @property {boolean} country print the country's name (reveals the answer)
 * @property {boolean} blur blur the signs, to hide their wording
 * @property {number} blurAmount blur strength, in tenths of a percent of the sign's width
 * @property {string} caption
 * @property {boolean} capTop caption above (true) or below (false)
 */

/**
 * @typedef {object} SheetContent
 * @property {import("./commons-data.js").Country | null} country
 * @property {import("./commons-data.js").Sign[]} signs in the order chosen, which is the order on the sheet
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

  /*
    The signs are laid out as the photo apps lay out photographs (shared
    photo-sheet.js): in the order they were picked, mixed rather than grouped
    by class, each keeping its own shape, with its credit in full underneath.
    When blurring is on, the blurred sign is what gets laid out.
  */
  await drawPhotos(
    ctx,
    signs.map((s) => ({ ...s, name: "" })),
    { x: pad, y: top, w: W - pad * 2, h: bottom - top },
    {
      loadImage: async (url) => renderSign(await loadImage(url), opts),
      names: false,
      fg: opts.fg,
      at: opts.at,
      labelFont: (px) => `600 ${px}px "Barlow Condensed", sans-serif`,
      creditFont: (px) => `400 ${px}px "Barlow", sans-serif`,
      creditText,
    },
  );
}

/**
 * Author, licence and a permanent link — never the file name, which names
 * the country.
 *
 * @param {import("./commons-data.js").Sign} rec
 */
function creditText(rec) {
  return [
    rec.author || "Wikimedia Commons",
    rec.licence.label,
    rec.describeUrl.replace(/^https:\/\//, ""),
  ]
    .filter(Boolean)
    .join(" · ");
}
