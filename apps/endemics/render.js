/**
 * Endemic animals — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { fitLine } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";

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
 * @property {boolean} capTop
 */

/**
 * @typedef {object} SheetContent
 * @property {{name: string} | null} country
 * @property {Species[]} species in the order chosen
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * Pick the column count that gives the largest cells. Photographs read best
 * near landscape, so cells far from that shape score lower.
 *
 * @param {number} n number of photographs
 * @param {number} w
 * @param {number} h
 * @param {number} gap
 * @param {number} extraPerCell height under each photograph for its labels
 */
function chooseGrid(n, w, h, gap, extraPerCell) {
  /** @type {{score: number, cols: number, rows: number, cellW: number, cellH: number, photoH: number} | null} */
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    const photoH = cellH - extraPerCell;
    if (cellW <= 8 || photoH <= 8) continue;
    const ratio = cellW / photoH;
    const score = Math.min(cellW, photoH) * (ratio > 0.6 && ratio < 2.2 ? 1 : 0.6);
    if (!best || score > best.score) best = { score, cols, rows, cellW, cellH, photoH };
  }
  return best;
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
    let px = Math.round(H * 0.045);
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

  if (!species.length) return;
  /** @type {Array<{rec: Species, img: HTMLImageElement}>} */
  const ready = [];
  for (const rec of species) {
    try {
      ready.push({ rec, img: await loadImage(rec.full) });
    } catch {
      try {
        ready.push({ rec, img: await loadImage(rec.thumb) });
      } catch {
        /* skip */
      }
    }
  }
  if (!ready.length) return;

  const boxW = W - pad * 2;
  const boxH = bottom - top;
  if (boxW < 40 || boxH < 40) return;
  const gap = Math.round(Math.min(boxW, boxH) * 0.025);
  const needsCredit = ready.some((r) => r.rec.licence.attribution);
  const labelPx = opts.names ? clamp(Math.round(boxH * 0.03), 12, 40) : 0;
  const credPx = needsCredit ? clamp(Math.round(boxH * 0.02), 9, 24) : 0;
  const extra = labelPx * 1.5 + credPx * 1.6;
  const best = chooseGrid(ready.length, boxW, boxH, gap, extra);
  if (!best) return;
  const gridH = best.rows * best.cellH + gap * (best.rows - 1);
  const yTop = top + Math.max(0, (boxH - gridH) / 2);

  ready.forEach(({ rec, img }, i) => {
    const r = Math.floor(i / best.cols);
    const c = i % best.cols;
    // Centre a short final row rather than leaving it hanging on the left.
    const inRow = Math.min(best.cols, ready.length - r * best.cols);
    const rowW = inRow * best.cellW + gap * (inRow - 1);
    const x = pad + (boxW - rowW) / 2 + c * (best.cellW + gap);
    const y = yTop + r * (best.cellH + gap);

    // Cover the cell rather than letterbox it: a wildlife photograph with
    // bars around it looks like a mistake.
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const scale = Math.max(best.cellW / iw, best.photoH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, best.cellW, best.photoH);
    ctx.clip();
    ctx.drawImage(img, x + (best.cellW - dw) / 2, y + (best.photoH - dh) / 2, dw, dh);
    ctx.restore();

    let ty = y + best.photoH;
    if (labelPx) {
      ctx.font = `italic 500 ${labelPx}px "Lora", Georgia, serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      let line = rec.name;
      while (line.length > 6 && ctx.measureText(line).width > best.cellW) line = line.slice(0, -2);
      if (line !== rec.name) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, x + best.cellW / 2, ty + labelPx * 0.25);
      ty += labelPx * 1.5;
    }
    if (credPx && rec.licence.attribution) {
      // The author and a permalink, never the file name: file names for
      // wildlife photographs routinely carry the place.
      const bits = [
        rec.author || "Wikimedia Commons",
        rec.licence.label,
        rec.describeUrl.replace(/^https:\/\//, ""),
      ].filter(Boolean);
      ctx.font = `400 ${credPx}px "Inter", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        fitLine(ctx, bits.join(" · "), best.cellW),
        x + best.cellW / 2,
        ty + credPx * 0.2,
      );
    }
  });
}
