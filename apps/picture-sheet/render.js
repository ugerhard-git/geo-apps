/**
 * Picture Sheet — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so the preview and the export are
 * the same code. The pictures are laid out by shared/photo-sheet.js, as in
 * Landmarks and Endemic animals: each keeps its own shape. There are no
 * per-picture credits; one credit line, typed by the visitor, goes at the
 * bottom.
 */

import { drawPhotos } from "../../shared/photo-sheet.js";
import { frameSpec } from "../../shared/sheet.js";

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at credit colour
 * @property {boolean} transparent
 * @property {string} caption
 * @property {number} captionScale caption size relative to the usual, 0.5–2
 * @property {boolean} capTop
 * @property {string} credit "" for none
 * @property {number} creditScale credit size relative to the usual, 0.5–2
 */

/**
 * @typedef {object} SheetPicture
 * @property {string} id
 * @property {string} name printed under the picture ("" for nothing)
 */

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetPicture[]} pictures in order
 * @param {(id: string) => Promise<ImageBitmap>} decoded
 */
export async function drawSheet(canvas, opts, pictures, decoded) {
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

  if (opts.credit) {
    let px = Math.max(8, Math.round(H * 0.018 * opts.creditScale));
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    while (px > 8 && ctx.measureText(opts.credit).width > W - pad * 2) {
      px -= 1;
      ctx.font = `400 ${px}px "Inter", sans-serif`;
    }
    ctx.fillStyle = opts.at;
    ctx.fillText(opts.credit, W / 2, bottom - px * 0.6, W - pad * 2);
    bottom -= px * 2.2;
  }

  if (opts.caption) {
    ctx.fillStyle = opts.fg;
    let px = Math.round(H * 0.045 * opts.captionScale);
    ctx.font = `600 ${px}px "Literata", Georgia, serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Literata", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  await drawPhotos(
    ctx,
    pictures.map((p) => ({
      name: p.name,
      full: p.id,
      thumb: p.id,
      licence: { attribution: false },
    })),
    { x: pad, y: top, w: W - pad * 2, h: bottom - top },
    {
      // An ImageBitmap draws like an image; photo-sheet reads its width and height.
      loadImage: /** @type {any} */ (decoded),
      names: pictures.some((p) => p.name),
      fg: opts.fg,
      at: opts.at,
      labelFont: (px) => `500 ${px}px "Literata", Georgia, serif`,
      creditFont: (px) => `400 ${px}px "Inter", sans-serif`,
      creditText: () => "",
    },
  );
}
