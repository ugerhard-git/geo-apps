/**
 * The "sheet": the canvas image each app draws and exports.
 *
 * Sheet apps share a size picker (`#frame` with presets such as `2400x1600`
 * plus `custom`, and `#customW` / `#customH`) and the PNG/JPG export flow.
 *
 * @module shared/sheet
 */

import { $ } from "./dom.js";
import { clamp } from "./util.js";

/** Largest sheet, in pixels, that is safe to allocate on most devices. */
export const MAX_PIXELS = 32e6;

/**
 * @typedef {object} Frame
 * @property {number} W width in pixels
 * @property {number} H height in pixels
 */

/**
 * Read the sheet size from the size controls. Each side is kept within
 * 64–8000 px, and the whole sheet is scaled down to {@link MAX_PIXELS}.
 *
 * @returns {Frame}
 */
export function frameSpec() {
  const v = $("frame").value;
  let W, H;
  if (v === "custom") {
    W = clamp(Math.round(+$("customW").value) || 0, 64, 8000);
    H = clamp(Math.round(+$("customH").value) || 0, 64, 8000);
  } else {
    const [a, b] = v.split("x");
    W = clamp(parseInt(a, 10) || 2400, 64, 8000);
    H = clamp(parseInt(b, 10) || 1600, 64, 8000);
  }
  if (W * H > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (W * H));
    W = Math.max(64, Math.round(W * k));
    H = Math.max(64, Math.round(H * k));
  }
  return { W, H };
}

/**
 * A short, stable, meaningless name for an export.
 *
 * Quiz sheets must not give the answer away in their filename, so when the
 * sheet hides what it shows, the file is named after a hash of its contents.
 *
 * @param {string} seed anything that identifies the sheet's contents
 * @returns {string} up to six base-36 characters
 */
export function hashSlug(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

/**
 * Encode a canvas as an image.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} type MIME type, e.g. `"image/png"`
 * @param {number} [quality=0.95] JPEG quality
 * @returns {Promise<Blob | null>} `null` if the browser refused to encode it
 */
export const canvasToBlob = (canvas, type, quality = 0.95) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Offer a blob to the user as a download.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
