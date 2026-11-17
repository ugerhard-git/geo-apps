/**
 * Picture Sheet — the part of a picture to use: a rectangle, kept as
 * fractions of the picture (0 to 1), so it doesn't depend on the size the
 * picture is kept or shown at.
 *
 * Pure functions, so they can be tested without a browser. Every result lies
 * inside the picture and is at least the minimum size; nothing here throws.
 */

/** @typedef {{x: number, y: number, w: number, h: number}} Crop */

/**
 * How a drag changes the rectangle: draw a new one, move it, or pull one of
 * its edges or corners.
 *
 * @typedef {"new" | "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"} DragMode
 */

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A crop made safe: inside the picture, or null if it isn't a rectangle at
 * all (missing, not numbers, no area).
 *
 * @param {any} c
 * @returns {Crop | null}
 */
export function normalise(c) {
  if (!c || typeof c !== "object") return null;
  const { x, y, w, h } = c;
  if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const x0 = clamp(Math.min(x, x + w), 0, 1);
  const y0 = clamp(Math.min(y, y + h), 0, 1);
  const x1 = clamp(Math.max(x, x + w), 0, 1);
  const y1 = clamp(Math.max(y, y + h), 0, 1);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Whether a crop leaves out so little that it is the whole picture.
 *
 * @param {Crop | null} c
 */
export const isWhole = (c) => !c || (c.w >= 0.999 && c.h >= 0.999);

/**
 * The crop in a picture's pixels: whole pixels, at least one, inside it.
 *
 * @param {Crop | null} c null for the whole picture
 * @param {number} W the picture's width
 * @param {number} H its height
 */
export function cropPixels(c, W, H) {
  const n = normalise(c);
  if (!n) return { sx: 0, sy: 0, sw: W, sh: H };
  const sx = clamp(Math.floor(n.x * W), 0, W - 1);
  const sy = clamp(Math.floor(n.y * H), 0, H - 1);
  const ex = clamp(Math.ceil((n.x + n.w) * W), sx + 1, W);
  const ey = clamp(Math.ceil((n.y + n.h) * H), sy + 1, H);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

/**
 * The rectangle after a drag from `from` to `to` (points as fractions of the
 * picture).
 *
 * @param {Crop | null} start the rectangle when the drag began
 * @param {DragMode} mode
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {{w: number, h: number}} min the smallest width and height, as fractions
 * @returns {Crop | null} null while a new rectangle is still too small
 */
export function dragCrop(start, mode, from, to, min) {
  const tx = clamp(to.x, 0, 1);
  const ty = clamp(to.y, 0, 1);
  if (mode === "new" || !start) {
    const fx = clamp(from.x, 0, 1);
    const fy = clamp(from.y, 0, 1);
    const w = Math.abs(tx - fx);
    const h = Math.abs(ty - fy);
    if (w < min.w || h < min.h) return null;
    return { x: Math.min(fx, tx), y: Math.min(fy, ty), w, h };
  }
  const dx = tx - clamp(from.x, 0, 1);
  const dy = ty - clamp(from.y, 0, 1);
  if (mode === "move")
    return {
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    };
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (mode.includes("w")) left = clamp(left + dx, 0, right - min.w);
  if (mode.includes("e")) right = clamp(right + dx, left + min.w, 1);
  if (mode.includes("n")) top = clamp(top + dy, 0, bottom - min.h);
  if (mode.includes("s")) bottom = clamp(bottom + dy, top + min.h, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The rectangle after an arrow key: moved, or with Shift made wider,
 * narrower, taller or shorter.
 *
 * @param {Crop} c
 * @param {string} key "ArrowLeft", "ArrowRight", "ArrowUp" or "ArrowDown"
 * @param {boolean} resize Shift was held
 * @param {{w: number, h: number}} min
 * @param {number} [step] as a fraction of the picture
 * @returns {Crop}
 */
export function nudge(c, key, resize, min, step = 0.01) {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  if (!resize)
    return {
      x: clamp(c.x + dx, 0, 1 - c.w),
      y: clamp(c.y + dy, 0, 1 - c.h),
      w: c.w,
      h: c.h,
    };
  return {
    x: c.x,
    y: c.y,
    w: clamp(c.w + dx, Math.min(min.w, 1 - c.x), 1 - c.x),
    h: clamp(c.h + dy, Math.min(min.h, 1 - c.y), 1 - c.y),
  };
}
