/**
 * Currency sheets — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { drawImageGrid } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp, own } from "../../shared/util.js";
import { SECTION_LABEL, SECTION_ORDER } from "./config.js";
import { factRows } from "./currency-info.js";

/** @typedef {import("./commons-data.js").Piece} Piece */

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent
 * @property {boolean} sections label the notes and coins bands
 * @property {boolean} facts print the currency facts
 * @property {boolean} factsTop facts above (true) or below (false)
 * @property {boolean} symbol print the symbol (reveals)
 * @property {boolean} baseUnit print the currency's name (reveals)
 * @property {boolean} subdivision print the subunit's name (reveals)
 * @property {boolean} specimen mark banknotes SPECIMEN
 * @property {boolean} articleImage include the article's illustration
 * @property {number} specimenAlpha opacity of the SPECIMEN mark, 0.1–0.9
 * @property {string} caption
 * @property {boolean} capTop
 */

/**
 * @typedef {object} SheetContent
 * @property {Piece[]} pieces the chosen notes and coins, in order
 * @property {Piece | null} articleImage the illustration hosted on Wikipedia
 * @property {import("./reference.js").Currency | null} currency
 * @property {import("./currency-info.js").CurrencyInfo | null} info
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * A note or coin as it will be drawn.
 *
 * Many jurisdictions accept a banknote reproduction marked SPECIMEN. The word
 * is drawn across the note with a contrasting outline so it reads on any
 * design, at a strength you control.
 *
 * @param {HTMLImageElement} img
 * @param {Piece} rec
 * @param {SheetOptions} opts
 * @returns {HTMLCanvasElement}
 */
function renderPiece(img, rec, opts) {
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  ctx.drawImage(img, 0, 0, w, h);

  const marksAllowed = rec.section === "notes" || rec.section === "article";
  if (!(opts.specimen && marksAllowed)) return c;

  const px = Math.max(10, Math.round(Math.min(w, h) * 0.26));
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.atan2(h, w));
  ctx.font = `600 ${px}px "Karla", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = clamp(opts.specimenAlpha, 0.05, 0.95);
  ctx.lineWidth = Math.max(2, px * 0.09);
  ctx.strokeStyle = "rgba(12,12,12,0.85)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeText("SPECIMEN", 0, 0);
  ctx.fillText("SPECIMEN", 0, 0);
  ctx.restore();
  return c;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export async function drawSheet(canvas, opts, content) {
  const { pieces, articleImage, currency, info, loadImage } = content;
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
    let px = Math.round(H * 0.045);
    ctx.font = `600 ${px}px "Spectral", Georgia, serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const t = opts.caption;
    while (px > 14 && ctx.measureText(t).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Spectral", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(t, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(t, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  // Work out whether any images will be drawn before deciding how to set the
  // facts: alone on the sheet they deserve a proper layout, not a packed line.
  /** @type {Array<{id: string, items: Piece[]}>} */
  const groups = [];
  if (opts.articleImage && articleImage) groups.push({ id: "article", items: [articleImage] });
  for (const id of SECTION_ORDER) {
    const items = pieces.filter((s) => s.section === id);
    if (items.length) groups.push({ id, items });
  }

  const rows = opts.facts ? factRows(opts, currency, info) : [];
  if (rows.length && !groups.length) {
    drawFactsPanel(ctx, rows, pad, top, W - pad * 2, bottom - top, opts);
    return;
  }
  if (rows.length) {
    const px = clamp(Math.round(H * 0.022), 11, 30);
    ctx.font = `400 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = rows.map((r) => `${r.label}: ${r.value}`);
    // Pack as many per line as fit, so the block stays compact.
    const packed = [];
    let cur = "";
    for (const line of lines) {
      const test = cur ? cur + "   ·   " + line : line;
      if (cur && ctx.measureText(test).width > W - pad * 2) {
        packed.push(cur);
        cur = line;
      } else cur = test;
    }
    if (cur) packed.push(cur);

    const blockH = packed.length * px * 1.45;
    let ly = opts.factsTop ? top + px * 0.9 : bottom - blockH + px * 0.9;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.88;
    for (const line of packed) {
      ctx.fillText(line, W / 2, ly);
      ly += px * 1.45;
    }
    ctx.globalAlpha = 1;
    if (opts.factsTop) top += blockH + px * 0.6;
    else bottom -= blockH + px * 0.6;
  }

  if (!groups.length) return;

  /** @type {Map<Piece, HTMLCanvasElement>} */
  const prepared = new Map();
  for (const rec of groups.flatMap((g) => g.items)) {
    let img;
    try {
      img = await loadImage(rec.full);
    } catch {
      try {
        img = await loadImage(rec.thumb);
      } catch {
        continue;
      }
    }
    prepared.set(rec, renderPiece(img, rec, opts));
  }

  const bandH = (bottom - top) / groups.length;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const items = g.items.filter((r) => prepared.has(r));
    if (!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    const heading = own(SECTION_LABEL, g.id) || "";
    if (opts.sections && heading) {
      const hPx = clamp(Math.round(bandH * 0.13), 15, 44);
      ctx.font = `600 ${hPx}px "Karla", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText(heading, pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7; // no heading means the band keeps the space
    }
    drawImageGrid(ctx, items, prepared, pad, y, W - pad * 2, bandTop + bandH - y - bandH * 0.05, {
      creditColour: opts.at,
      creditFont: '"Karla", sans-serif',
      maxCreditPx: 20,
      authorPrefix: "Photo: ",
    });
  }
}

/**
 * Facts with the sheet to themselves: a ruled two-column list, centred, with
 * the type as large as the space allows. One column when there are few rows or
 * the frame is tall, two when there are many and it is wide.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./currency-info.js").FactRow[]} rows
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {SheetOptions} opts
 */
function drawFactsPanel(ctx, rows, x, y, w, h, opts) {
  if (!rows.length || w <= 20 || h <= 20) return;

  // Measure once at a reference size, then scale.
  const probe = 100;
  ctx.font = `500 ${probe}px "Karla", sans-serif`;
  let widestLabel = 0;
  for (const r of rows) widestLabel = Math.max(widestLabel, ctx.measureText(r.label).width);
  ctx.font = `400 ${probe}px "Karla", sans-serif`;
  let widestValue = 0;
  for (const r of rows) widestValue = Math.max(widestValue, ctx.measureText(r.value).width);

  const gapRatio = 0.6;
  const unit = (widestLabel + widestValue) / probe + gapRatio;

  // Rather than guess at one or two columns, try both and keep whichever
  // makes the type larger — the same rule the image grid uses.
  /** @type {{cols: number, perCol: number, colGap: number, colW: number, px: number} | null} */
  let best = null;
  for (const cols of rows.length >= 4 ? [1, 2] : [1]) {
    const perCol = Math.ceil(rows.length / cols);
    const colGap = w * 0.06;
    const colW = (w - colGap * (cols - 1)) / cols;
    if (colW <= 20) continue;
    const px = Math.min(colW / unit, h / (perCol * 1.9 + 0.6));
    if (!best || px > best.px) best = { cols, perCol, colGap, colW, px };
  }
  if (!best) return;
  const layout = best;

  const px = clamp(layout.px, 12, Math.round(h * 0.13));
  const lineH = px * 1.9;
  const blockH = layout.perCol * lineH;
  const gap = px * gapRatio;
  const labelW = (widestLabel / probe) * px;
  const startY = y + Math.max(0, (h - blockH) / 2) + lineH * 0.5;

  ctx.textBaseline = "middle";
  rows.forEach((r, i) => {
    const c = Math.floor(i / layout.perCol);
    const row = i % layout.perCol;
    const colX = x + c * (layout.colW + layout.colGap);
    const ly = startY + row * lineH;

    // A hairline under each pair, which is what makes a list like this read.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = opts.fg;
    ctx.fillRect(
      colX,
      Math.round(ly + lineH * 0.42),
      layout.colW,
      Math.max(1, Math.round(px * 0.03)),
    );

    ctx.globalAlpha = 0.62;
    ctx.font = `500 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(r.label, colX + labelW, ly);

    ctx.globalAlpha = r.reveal ? 1 : 0.92;
    ctx.font = `400 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(r.value, colX + labelW + gap, ly);
  });
  ctx.globalAlpha = 1;
}
