/**
 * Blurring part or all of an image on a canvas, used to hide giveaway text
 * (registration numbers, words on road signs).
 *
 * Canvas filter support has been uneven in Safari, so a downscale-and-upscale
 * pass stands in where it's missing. Both give the soft, unreadable look of a
 * blurred plate; neither claims to reproduce anyone's algorithm.
 *
 * @module shared/blur
 */

/** @type {boolean | null} */
let canvasFilterSupported = null;

/**
 * Whether `ctx.filter = "blur(…)"` works in this browser. Checked once.
 *
 * @returns {boolean}
 */
export function supportsCanvasFilter() {
  if (canvasFilterSupported !== null) return canvasFilterSupported;
  try {
    const c = document.createElement("canvas");
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    ctx.filter = "blur(2px)";
    canvasFilterSupported = ctx.filter === "blur(2px)";
  } catch {
    canvasFilterSupported = false;
  }
  return canvasFilterSupported;
}

/**
 * Blur a rectangle of `src` into the same rectangle of `dest`.
 *
 * These must be different canvases: reading a canvas while writing to it makes
 * the browser blur only part of the image, because the source is being
 * rewritten as it is read.
 *
 * @param {HTMLCanvasElement} dest
 * @param {HTMLCanvasElement} src
 * @param {number} sx
 * @param {number} sy
 * @param {number} sw
 * @param {number} sh
 * @param {number} radius blur radius in pixels; 0.5 or less copies unblurred
 */
export function blurInto(dest, src, sx, sy, sw, sh, radius) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (dest.getContext("2d"));
  if (dest === src) throw new Error("blurInto needs a separate source canvas");
  if (radius <= 0.5) {
    ctx.drawImage(src, sx, sy, sw, sh, sx, sy, sw, sh);
    return;
  }

  if (supportsCanvasFilter()) {
    // Reach beyond the rectangle so the blur pulls in real neighbouring
    // pixels, clamped to what exists, and drawn 1:1 so nothing shifts.
    const o = Math.ceil(radius * 2);
    const x0 = Math.max(0, sx - o);
    const y0 = Math.max(0, sy - o);
    const x1 = Math.min(src.width, sx + sw + o);
    const y1 = Math.min(src.height, sy + sh + o);
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, x0, y0, rw, rh, x0, y0, rw, rh);
    ctx.restore();
    return;
  }

  // No canvas filter: shrink the region hard, then let the browser's smoothing
  // enlarge it again. Different arithmetic, similar look.
  const f = Math.max(2, Math.round(radius));
  const tw = Math.max(1, Math.round(sw / f));
  const th = Math.max(1, Math.round(sh / f));
  const small = document.createElement("canvas");
  small.width = tw;
  small.height = th;
  const sctx = /** @type {CanvasRenderingContext2D} */ (small.getContext("2d"));
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, sw, sh);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, tw, th, sx, sy, sw, sh);
  ctx.restore();
}

/**
 * Blur the whole of `src` into `dest` (same size).
 *
 * @param {HTMLCanvasElement} dest
 * @param {HTMLCanvasElement} src
 * @param {number} radius
 */
export const blurAll = (dest, src, radius) =>
  blurInto(dest, src, 0, 0, src.width, src.height, radius);

/**
 * Copy an image (or canvas) onto a new canvas at its natural size.
 *
 * @param {HTMLImageElement | HTMLCanvasElement} img
 * @returns {HTMLCanvasElement}
 */
export function toCanvas(img) {
  const w = Math.max(1, ("naturalWidth" in img && img.naturalWidth) || img.width);
  const h = Math.max(1, ("naturalHeight" in img && img.naturalHeight) || img.height);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  /** @type {CanvasRenderingContext2D} */ (c.getContext("2d")).drawImage(img, 0, 0, w, h);
  return c;
}
