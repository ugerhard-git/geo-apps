/**
 * Place-name endings — drawing the sheet, in one of two views:
 *   cloud  the typical endings, bigger for more common, in rows
 *   towns  a dozen real place names, typical endings in colour
 * Both have a caption, an explanation, a footnote and a credit. The preview
 * and the export are drawn by the same functions.
 */

/** @typedef {import("./endings.js").Ending} Ending */

/**
 * @typedef {object} SheetOptions
 * @property {number} W
 * @property {number} H
 * @property {string} bg background
 * @property {boolean} transparent no background: only the drawing and text
 * @property {string} ink text
 * @property {string} accent first highlight
 * @property {string} second second highlight
 * @property {string} caption "" for none
 * @property {string} subtitle the explanation under it, "" for none
 * @property {string} footnote under the words, "" for none
 * @property {string} credit "" for none
 */

/**
 * @typedef {object} Content
 * @property {"cloud" | "towns"} view
 * @property {Ending[]} endings
 * @property {Array<[string, string]>} towns each split before its ending ("" when it has none)
 * @property {boolean} colourEndings colour the towns' endings
 */

const SANS = '"Space Grotesk", sans-serif';
// Literata rather than Fraunces (which Subdivision clouds uses): Fraunces'
// bold puts the macron of ā, ū and ō over the next letter, and Indian and
// Japanese place names are full of them.
const SERIF = "Literata, Georgia, serif";

/**
 * The largest font size, down to `minPx`, at which `text` fits `maxW`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} px
 * @param {number} minPx
 * @param {string} font weight and family, e.g. `500 ${SANS}`
 * @param {number} maxW
 */
function fitPx(ctx, text, px, minPx, font, maxW) {
  let size = px;
  for (; size > minPx; size -= 1) {
    ctx.font = font.replace("{px}", `${size}px`);
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

/**
 * The cloud's order: the most common ending in the middle, the others
 * alternating to its left and right, so the big words gather in the centre.
 *
 * @param {Ending[]} endings
 * @returns {Ending[]}
 */
export function cloudOrder(endings) {
  const sorted = [...endings].sort((a, b) => b.count - a.count);
  /** @type {Ending[]} */
  const out = [];
  sorted.forEach((e, i) => (i % 2 ? out.push(e) : out.unshift(e)));
  return out;
}

/**
 * Each ending's size relative to the largest (0.4–1), by the square root of
 * its count, so area rather than height follows how common it is.
 *
 * @param {Ending[]} endings
 * @returns {Map<Ending, number>}
 */
export function relativeSizes(endings) {
  const roots = endings.map((e) => Math.sqrt(e.count));
  const hi = Math.max(...roots);
  const lo = Math.min(...roots);
  return new Map(
    endings.map((e, i) => [e, hi === lo ? 1 : 0.4 + (0.6 * (roots[i] - lo)) / (hi - lo)]),
  );
}

/**
 * Draw the sheet.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} o
 * @param {Content} c
 */
export function drawSheet(canvas, o, c) {
  const { W, H } = o;
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const u = Math.min(W, H) / 1000;
  const padX = Math.max(W * 0.06, 24 * u);
  const maxText = W - 2 * padX;
  if (!o.transparent) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.textBaseline = "alphabetic";

  // Top: caption and explanation.
  let y = H * 0.07;
  if (o.caption) {
    const px = fitPx(
      ctx,
      o.caption,
      Math.round(46 * u),
      Math.round(20 * u),
      `500 {px} ${SANS}`,
      maxText,
    );
    y += px;
    ctx.font = `500 ${px}px ${SANS}`;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.caption, W / 2, y);
    y += 14 * u;
  }
  if (o.subtitle) {
    const px = fitPx(
      ctx,
      o.subtitle,
      Math.round(27 * u),
      Math.round(14 * u),
      `400 {px} ${SANS}`,
      maxText,
    );
    y += px;
    ctx.font = `400 ${px}px ${SANS}`;
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.subtitle, W / 2, y);
    ctx.globalAlpha = 1;
  }
  const top = y + 40 * u;

  // Bottom: credit, then the footnote above it.
  let bottom = H - H * 0.05;
  const smallPx = Math.round(17 * u);
  if (o.credit) {
    ctx.font = `400 ${smallPx}px ${SANS}`;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "right";
    ctx.fillText(o.credit, W - padX, bottom);
    ctx.globalAlpha = 1;
    bottom -= smallPx + 18 * u;
  }
  if (o.footnote) {
    const px = fitPx(
      ctx,
      o.footnote,
      Math.round(20 * u),
      Math.round(12 * u),
      `400 {px} ${SANS}`,
      maxText,
    );
    ctx.font = `400 ${px}px ${SANS}`;
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.footnote, W / 2, bottom);
    ctx.globalAlpha = 1;
    bottom -= px + 30 * u;
  }

  const area = { x: padX, y: top, w: W - 2 * padX, h: bottom - top };
  if (area.h < 40 * u) return;
  if (c.view === "cloud") drawCloud(ctx, o, c.endings, area, u);
  else drawTowns(ctx, o, c, area, u);
}

/**
 * The endings in centred rows, as large as the area allows.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {SheetOptions} o
 * @param {Ending[]} endings
 * @param {{x: number, y: number, w: number, h: number}} area
 * @param {number} u
 */
function drawCloud(ctx, o, endings, area, u) {
  if (!endings.length) return;
  const order = cloudOrder(endings);
  const rel = relativeSizes(endings);
  const colours = [o.accent, o.ink, o.second];
  const gap = 0.32; // space between words, as a share of the larger one's size

  /**
   * Lay the words out in rows at a given largest size.
   *
   * @param {number} big
   */
  const layout = (big) => {
    /** @type {Array<{items: Array<{e: Ending, px: number, w: number}>, w: number, h: number}>} */
    const rows = [];
    let row = { items: /** @type {Array<{e: Ending, px: number, w: number}>} */ ([]), w: 0, h: 0 };
    for (const e of order) {
      const px = Math.round(big * /** @type {number} */ (rel.get(e)));
      ctx.font = `700 ${px}px ${SERIF}`;
      const w = ctx.measureText(`-${e.text}`).width;
      const add = row.items.length ? w + px * gap : w;
      if (row.items.length && row.w + add > area.w) {
        rows.push(row);
        row = { items: [], w: 0, h: 0 };
      }
      row.w += row.items.length ? w + px * gap : w;
      row.h = Math.max(row.h, px);
      row.items.push({ e, px, w });
    }
    if (row.items.length) rows.push(row);
    const height = rows.reduce((s, r) => s + r.h * 1.18, 0);
    return { rows, height, widest: Math.max(...rows.map((r) => r.w)) };
  };

  // The largest size that fits, from about a sixth of the sheet down.
  let big = Math.round(Math.min(area.h * 0.42, 190 * u));
  let plan = layout(big);
  while (big > 14 * u && (plan.height > area.h || plan.widest > area.w)) {
    big = Math.floor(big * 0.94);
    plan = layout(big);
  }

  let y = area.y + (area.h - plan.height) / 2;
  let i = 0;
  ctx.textAlign = "left";
  for (const row of plan.rows) {
    y += row.h * 1.18;
    let x = area.x + (area.w - row.w) / 2;
    for (const item of row.items) {
      ctx.font = `700 ${item.px}px ${SERIF}`;
      ctx.fillStyle = colours[i++ % colours.length];
      // Words share a baseline a little above the row's foot, for descenders.
      ctx.fillText(`-${item.e.text}`, x, y - row.h * 0.2);
      x += item.w + item.px * gap;
    }
  }
}

/**
 * Up to twelve names in three columns, each with a rule under it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {SheetOptions} o
 * @param {Content} c
 * @param {{x: number, y: number, w: number, h: number}} area
 * @param {number} u
 */
function drawTowns(ctx, o, c, area, u) {
  const names = c.towns;
  if (!names.length) return;
  const cols = names.length > 8 ? 3 : names.length > 4 ? 2 : 1;
  const rows = Math.ceil(names.length / cols);
  const colGap = 60 * u;
  const colW = (area.w - colGap * (cols - 1)) / cols;
  const rowH = Math.min(area.h / rows, 120 * u);
  // One size for every name: the largest at which the longest fits its column.
  let px = Math.round(Math.min(rowH * 0.55, 62 * u));
  for (; px > 12 * u; px--) {
    ctx.font = `600 ${px}px ${SERIF}`;
    if (names.every(([a, b]) => ctx.measureText(a + b).width <= colW)) break;
  }
  ctx.font = `600 ${px}px ${SERIF}`;
  const blockH = rows * rowH;
  const y0 = area.y + (area.h - blockH) / 2;
  names.forEach(([stem, end], i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x = area.x + col * (colW + colGap);
    const base = y0 + row * rowH + rowH * 0.62;
    ctx.textAlign = "left";
    ctx.fillStyle = o.ink;
    ctx.fillText(stem, x, base);
    if (end) {
      ctx.fillStyle = c.colourEndings ? o.accent : o.ink;
      ctx.fillText(end, x + ctx.measureText(stem).width, base);
    }
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    ctx.moveTo(x, Math.round(y0 + (row + 1) * rowH - rowH * 0.12) + 0.5);
    ctx.lineTo(x + colW, Math.round(y0 + (row + 1) * rowH - rowH * 0.12) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}
