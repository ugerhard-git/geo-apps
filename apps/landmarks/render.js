/**
 * Landmarks — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so the preview and the export are
 * the same code. The photographs themselves are laid out and credited by
 * shared/photo-sheet.js.
 */

import { drawPhotos } from "../../shared/photo-sheet.js";
import { frameSpec } from "../../shared/sheet.js";

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent
 * @property {boolean} names print each landmark's name (reveals the answer)
 * @property {boolean} country print the country's name (reveals the answer)
 * @property {string} caption
 * @property {number} captionScale caption size relative to the usual, 0.5–2
 * @property {number} creditScale credit size relative to the usual, 0.5–2
 * @property {boolean} capTop
 */

/**
 * @typedef {object} Photo a landmark with the photograph chosen for it
 * @property {string} name
 * @property {string} thumb
 * @property {string} full
 * @property {string} author
 * @property {import("../../shared/commons.js").Licence} licence
 * @property {string} describeUrl
 */

/**
 * @typedef {object} SheetContent
 * @property {string} countryName
 * @property {Photo[]} photos in the order chosen
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * The author, the licence and a permanent link — never the file name, which
 * for a landmark almost always is its name.
 *
 * @param {Photo} p
 */
export function creditText(p) {
  return [
    p.author || "Wikimedia Commons",
    p.licence.label,
    p.describeUrl.replace(/^https:\/\//, ""),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export async function drawSheet(canvas, opts, { countryName, photos, loadImage }) {
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
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (opts.caption) {
    ctx.fillStyle = opts.fg;
    let px = Math.round(H * 0.045 * opts.captionScale);
    ctx.font = `600 ${px}px "Fraunces", Georgia, serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Fraunces", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  if (opts.country && countryName) {
    const px = Math.round(H * 0.03);
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.fillText(countryName, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  await drawPhotos(
    ctx,
    photos,
    { x: pad, y: top, w: W - pad * 2, h: bottom - top },
    {
      loadImage,
      names: opts.names,
      fg: opts.fg,
      at: opts.at,
      labelFont: (px) => `500 ${px}px "Fraunces", Georgia, serif`,
      creditScale: opts.creditScale,
      creditFont: (px) => `400 ${px}px "Inter", sans-serif`,
      creditText,
    },
  );
}
