/**
 * Subdivision clouds — sizing tags and laying the word cloud out.
 */

/**
 * @typedef {object} Tag
 * @property {string} text
 * @property {number} rel relative size, 0.35–1
 * @property {string} colour
 */

/**
 * @typedef {Tag & {
 *   rotated: boolean,
 *   px: number, w: number, h: number, textW: number, textH: number,
 *   x: number, y: number,
 * }} PlacedTag a tag with its size and centre point
 */

/**
 * Map values to relative tag sizes between 0.35 and 1.
 *
 * Logarithmic, so a region twenty times another's size reads as bigger
 * without making the smaller one invisible. Sizes are relative to the
 * subdivisions actually chosen, not the whole country.
 *
 * @param {number[]} values all positive
 * @returns {number[]}
 */
export function relativeSizes(values) {
  const n = values.length;
  if (!n) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Every region the same size, or only one: no spread to map.
  if (!(hi > lo)) return values.map(() => 0.65);
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  return values.map((v) => 0.35 + 0.65 * ((Math.log(v) - logLo) / (logHi - logLo)));
}

/** @param {number} px */
export function tagFont(px) {
  return `700 ${Math.max(1, Math.round(px))}px "Fraunces", Georgia, serif`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Tag & {rotated: boolean}>} tags
 * @param {number} scale font size of a tag with `rel` 1
 */
function measureTags(ctx, tags, scale) {
  return tags.map((t) => {
    ctx.font = tagFont(t.rel * scale);
    const w = ctx.measureText(t.text).width;
    const h = t.rel * scale * 1.02;
    return {
      ...t,
      px: t.rel * scale,
      w: t.rotated ? h : w,
      h: t.rotated ? w : h,
      textW: w,
      textH: h,
    };
  });
}

/**
 * Greedy lines, centred — the classic cloud shape.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Tag[]} tags
 * @param {number} w
 * @param {number} h
 * @param {number} scale
 * @returns {PlacedTag[] | null} `null` when they don't fit
 */
function layoutWrapped(ctx, tags, w, h, scale) {
  const sized = measureTags(
    ctx,
    tags.map((t) => ({ ...t, rotated: false })),
    scale,
  );
  const gap = scale * 0.12;
  /** @type {Array<{items: typeof sized, w: number}>} */
  const lines = [];
  let line = [];
  let lineW = 0;
  for (const t of sized) {
    const add = t.w + (line.length ? gap : 0);
    if (line.length && lineW + add > w) {
      lines.push({ items: line, w: lineW });
      line = [];
      lineW = 0;
    }
    line.push(t);
    lineW += t.w + (line.length > 1 ? gap : 0);
  }
  if (line.length) lines.push({ items: line, w: lineW });
  const lineHeights = lines.map((l) => l.items.reduce((m, t) => Math.max(m, t.h), 0));
  const totalH = lineHeights.reduce((s, x) => s + x * 1.18, 0);
  if (totalH > h) return null;
  if (lines.some((l) => l.w > w)) return null;
  /** @type {PlacedTag[]} */
  const placed = [];
  let y = (h - totalH) / 2;
  lines.forEach((l, i) => {
    let x = (w - l.w) / 2;
    for (const t of l.items) {
      placed.push({ ...t, x: x + t.w / 2, y: y + lineHeights[i] / 2 });
      x += t.w + gap;
    }
    y += lineHeights[i] * 1.18;
  });
  return placed;
}

/**
 * Largest first at the centre, then outwards along a spiral until each fits.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Tag[]} tags
 * @param {number} w
 * @param {number} h
 * @param {number} scale
 * @param {boolean} allowRotate turn every third tag on its side
 * @returns {PlacedTag[] | null} `null` when they don't fit
 */
function layoutSpiral(ctx, tags, w, h, scale, allowRotate) {
  const order = tags.slice().sort((a, b) => b.rel - a.rel);
  const sized = measureTags(
    ctx,
    order.map((t, i) => ({ ...t, rotated: allowRotate && i % 3 === 1 })),
    scale,
  );
  /** @type {PlacedTag[]} */
  const placed = [];
  const pad = scale * 0.08;
  /**
   * @param {number} x
   * @param {number} y
   * @param {{w: number, h: number}} t
   */
  const fits = (x, y, t) => {
    if (x - t.w / 2 < 0 || x + t.w / 2 > w || y - t.h / 2 < 0 || y + t.h / 2 > h) return false;
    return !placed.some(
      (p) => Math.abs(p.x - x) < (p.w + t.w) / 2 + pad && Math.abs(p.y - y) < (p.h + t.h) / 2 + pad,
    );
  };
  for (const t of sized) {
    let done = false;
    const step = Math.max(2, scale * 0.06);
    for (let a = 0; a < 220 && !done; a += 0.35) {
      const r = step * a * 0.55;
      const x = w / 2 + r * Math.cos(a) * 1.35; // wider than tall, like the frame
      const y = h / 2 + r * Math.sin(a) * 0.75;
      if (fits(x, y, t)) {
        placed.push({ ...t, x, y });
        done = true;
      }
    }
    if (!done) return null;
  }
  return placed;
}

/**
 * Find the largest scale at which the whole cloud still fits, so a handful of
 * regions fills the frame just as a full set does.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Tag[]} tags
 * @param {number} w
 * @param {number} h
 * @param {"spiral" | "wrapped"} mode
 * @param {boolean} allowRotate
 * @returns {PlacedTag[] | null}
 */
export function fitCloud(ctx, tags, w, h, mode, allowRotate) {
  /** @param {number} s */
  const run = (s) =>
    mode === "spiral"
      ? layoutSpiral(ctx, tags, w, h, s, allowRotate)
      : layoutWrapped(ctx, tags, w, h, s);
  let lo = 8;
  let hi = Math.max(12, h);
  let best = null;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const got = run(mid);
    if (got) {
      best = got;
      lo = mid;
    } else hi = mid;
  }
  return best || run(8);
}
