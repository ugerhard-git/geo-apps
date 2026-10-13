/**
 * Laying a set of images out as a grid on a sheet, each with its attribution
 * line underneath when its licence asks for one.
 *
 * Used by the Commons image apps (currency, plates, road signs).
 *
 * @module shared/image-grid
 */

import { clamp } from "./util.js";

/**
 * @typedef {object} GridItem
 * @property {{ attribution: boolean, label: string }} licence
 * @property {string} author
 * @property {string} describeUrl the file page, credited instead of the title
 */

/**
 * @typedef {object} GridLayout
 * @property {number} worst scale of the smallest image (what is maximised)
 * @property {number} cols
 * @property {number} rows
 * @property {number} cellW
 * @property {number} cellH
 * @property {number} credPx credit font size, 0 when no credits are needed
 * @property {number} imageH height left for the image once the credit is placed
 */

/**
 * Pick the column count that makes the smallest image as large as possible.
 * Every count is tried, so a section of wide images and one of tall images
 * each get the arrangement that suits them.
 *
 * @template {object} T
 * @param {T[]} items
 * @param {Map<T, HTMLCanvasElement>} prepared each item's finished image
 * @param {number} w
 * @param {number} h
 * @param {number} gap
 * @param {boolean} needsCredit leave room under each image for a credit line
 * @param {number} maxCreditPx
 * @returns {GridLayout | null}
 */
export function chooseGrid(items, prepared, w, h, gap, needsCredit, maxCreditPx) {
  const K = items.length;
  /** @type {GridLayout | null} */
  let best = null;

  for (let cols = 1; cols <= K; cols++) {
    const rows = Math.ceil(K / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    if (cellW <= 4 || cellH <= 4) continue;

    const credPx = needsCredit ? clamp(Math.round(cellH * 0.13), 9, maxCreditPx) : 0;
    const imageH = cellH - (credPx ? credPx * 2.0 : 0);
    if (imageH <= 4) continue;

    let worst = Infinity;
    for (const rec of items) {
      const p = prepared.get(rec);
      if (!p || !p.width || !p.height) continue;
      worst = Math.min(worst, Math.min(cellW / p.width, imageH / p.height));
    }
    if (!Number.isFinite(worst)) continue;
    if (!best || worst > best.worst) best = { worst, cols, rows, cellW, cellH, credPx, imageH };
  }
  return best;
}

/**
 * Shorten `text` with an ellipsis, at a word boundary, until it fits `maxWidth`
 * in the context's current font.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
export function fitLine(ctx, text, maxWidth) {
  let line = text;
  while (line.length > 12 && ctx.measureText(line).width > maxWidth) line = line.slice(0, -2);
  if (line !== text) line = line.replace(/\s+\S*$/, "") + "…";
  return line;
}

/**
 * @typedef {object} GridStyle
 * @property {string} creditColour fill colour of the credit lines
 * @property {string} creditFont CSS font family for the credit lines, e.g. `'"Barlow", sans-serif'`
 * @property {number} maxCreditPx largest credit font size
 * @property {string} [authorPrefix=""] put before the author's name, e.g. `"Photo: "`
 */

/**
 * Draw `items` as a centred grid inside the box `(x, y, w, h)`.
 *
 * The credit names the author and a permalink, never the file title: the
 * title usually says which country an image is from.
 *
 * @template {GridItem} T
 * @param {CanvasRenderingContext2D} ctx
 * @param {T[]} items
 * @param {Map<T, HTMLCanvasElement>} prepared each item's finished image
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {GridStyle} style
 */
export function drawImageGrid(ctx, items, prepared, x, y, w, h, style) {
  if (!items.length || h <= 10 || w <= 10) return;
  const needsCredit = items.some((r) => r.licence.attribution);
  const gap = Math.max(6, Math.round(Math.min(w, h) * 0.03));
  const best = chooseGrid(items, prepared, w, h, gap, needsCredit, style.maxCreditPx);
  if (!best) return;

  const { cols, rows, cellW, cellH, credPx, imageH } = best;
  const gridH = rows * cellH + gap * (rows - 1);
  const yTop = y + Math.max(0, (h - gridH) / 2);

  items.forEach((rec, i) => {
    const piece = prepared.get(rec);
    if (!piece) return;
    const r = Math.floor(i / cols);
    const c = i % cols;

    // Centre a short final row rather than leaving it hanging on the left.
    const inRow = Math.min(cols, items.length - r * cols);
    const rowW = inRow * cellW + gap * (inRow - 1);
    const cellX = x + (w - rowW) / 2 + c * (cellW + gap);
    const cellY = yTop + r * (cellH + gap);

    const scale = Math.min(cellW / piece.width, imageH / piece.height);
    const dw = Math.max(1, Math.round(piece.width * scale));
    const dh = Math.max(1, Math.round(piece.height * scale));
    ctx.drawImage(
      piece,
      Math.round(cellX + (cellW - dw) / 2),
      Math.round(cellY + (imageH - dh) / 2),
      dw,
      dh,
    );

    if (credPx && rec.licence.attribution) {
      const bits = [
        rec.author ? `${style.authorPrefix || ""}${rec.author}` : "Wikimedia Commons",
        rec.licence.label,
        rec.describeUrl.replace(/^https:\/\//, ""),
      ].filter(Boolean);
      ctx.font = `400 ${credPx}px ${style.creditFont}`;
      ctx.fillStyle = style.creditColour;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const line = fitLine(ctx, bits.join(" · "), cellW);
      ctx.fillText(line, cellX + cellW / 2, cellY + imageH + credPx * 0.4);
    }
  });
}
