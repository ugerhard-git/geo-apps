/**
 * Endemic animals — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { drawPhotos } from "../../shared/photo-sheet.js";
import { frameSpec } from "../../shared/sheet.js";

/** @typedef {import("./species-data.js").Species} Species */

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent
 * @property {boolean} names print each species' name (reveals the answer)
 * @property {boolean} country print the country's name (reveals the answer)
 * @property {string} caption
 * @property {number} captionScale caption size relative to the usual, 0.5–2
 * @property {number} creditScale credit size relative to the usual, 0.5–2
 * @property {boolean} capTop
 */

/**
 * @typedef {object} SheetContent
 * @property {{name: string} | null} country
 * @property {Species[]} species in the order chosen
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * The author and a permalink, never the file name: file names for wildlife
 * photographs routinely carry the place.
 *
 * @param {Species} rec
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

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export async function drawSheet(canvas, opts, { country, species, loadImage }) {
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
    let px = Math.round(H * 0.045 * opts.captionScale);
    ctx.font = `600 ${px}px "Lora", Georgia, serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Lora", Georgia, serif`;
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
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  await drawPhotos(
    ctx,
    species,
    { x: pad, y: top, w: W - pad * 2, h: bottom - top },
    {
      loadImage,
      names: opts.names,
      fg: opts.fg,
      at: opts.at,
      labelFont: (px) => `italic 500 ${px}px "Lora", Georgia, serif`,
      creditScale: opts.creditScale,
      creditFont: (px) => `400 ${px}px "Inter", sans-serif`,
      creditText,
    },
  );
}
