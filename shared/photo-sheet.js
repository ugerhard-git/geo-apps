/**
 * Photographs on a sheet, uncropped, each with its credit in full.
 *
 * Shared by the photo apps (Endemic animals, Landmarks). The photographs keep
 * their own shape (justified.js) and every credit is shown whole, wrapped and
 * if need be set smaller (credits.js).
 *
 * @module shared/photo-sheet
 */

import { fitCredit } from "./credits.js";
import { fitLine } from "./image-grid.js";
import { justifiedRows } from "./justified.js";
import { clamp } from "./util.js";

/**
 * @typedef {object} PhotoRecord
 * @property {string} name printed under the photo when `names` is on
 * @property {string} full a large render
 * @property {string} thumb a small one, used if the large one fails
 * @property {{attribution: boolean}} licence whether a credit is required
 */

/**
 * @typedef {object} PhotoStyle
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 * @property {boolean} names print each record's name under its photo
 * @property {string} fg colour of the names
 * @property {string} at colour of the credits
 * @property {(px: number) => string} labelFont CSS font for names
 * @property {(px: number) => string} creditFont CSS font for credits
 * @property {(rec: any) => string} creditText the credit line for a record
 */

/** Most lines a photo credit may wrap onto. */
const MAX_CREDIT_LINES = 4;
/** Smallest credit font, in sheet pixels, before a credit is trimmed instead. */
const MIN_CREDIT_PX = 6;

/**
 * Lay out and draw photographs in `area`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {PhotoRecord[]} records in order
 * @param {{x: number, y: number, w: number, h: number}} area
 * @param {PhotoStyle} style
 */
export async function drawPhotos(ctx, records, area, style) {
  if (!records.length) return;
  /** @type {Array<{rec: PhotoRecord, img: HTMLImageElement}>} */
  const ready = [];
  for (const rec of records) {
    try {
      ready.push({ rec, img: await style.loadImage(rec.full) });
    } catch {
      try {
        ready.push({ rec, img: await style.loadImage(rec.thumb) });
      } catch {
        /* skip */
      }
    }
  }
  if (!ready.length) return;

  const boxW = area.w;
  const boxH = area.h;
  if (boxW < 40 || boxH < 40) return;
  const gap = Math.round(Math.min(boxW, boxH) * 0.025);
  const needsCredit = ready.some((r) => r.rec.licence.attribution);
  const labelPx = style.names ? clamp(Math.round(boxH * 0.03), 12, 40) : 0;
  const credPx = needsCredit ? clamp(Math.round(boxH * 0.02), 9, 24) : 0;
  const aspects = ready.map(({ img }) => {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    return iw / ih;
  });

  // Credits are shown in full (see credits.js): wrapped onto several lines
  // and, only if that is not enough, set smaller. Room under each row is tried
  // for 1 to MAX_CREDIT_LINES lines of credit. The fewest lines at which every
  // credit stays comfortably readable win, since fewer lines leave the photos
  // more room; failing that, the choice whose smallest credit is largest.
  // Every photograph keeps its own shape (see justified.js).
  const texts = ready.map(({ rec }) => (rec.licence.attribution ? style.creditText(rec) : null));
  const readablePx = Math.max(8, Math.round(credPx * 0.7));
  /** @param {string} t @param {number} px */
  const measureAt = (t, px) => {
    ctx.font = style.creditFont(px);
    return ctx.measureText(t).width;
  };
  const box = area;
  /** @typedef {{px: number, lines: string[]} | null} Fit */
  /** @type {{placed: import("./justified.js").Placed[], fits: Fit[], worst: number} | null} */
  let best = null;
  for (let lines = 1; lines <= (needsCredit ? MAX_CREDIT_LINES : 1); lines++) {
    const extra = labelPx * 1.5 + (needsCredit ? credPx * (1.25 * lines + 0.4) : 0);
    const placed = justifiedRows(aspects, box, gap, extra);
    if (!placed.length) continue;
    const fits = texts.map((t, i) =>
      t
        ? fitCredit(t, placed[i].w, lines, credPx, MIN_CREDIT_PX, measureAt)
        : { px: Infinity, lines: [] },
    );
    const worst = Math.min(...fits.map((f) => (f ? f.px : 0)));
    if (!best || worst > best.worst) best = { placed, fits, worst };
    if (worst >= readablePx) break;
  }
  if (!best) return;
  const { placed } = best;
  // Only if a credit cannot fit even at the smallest size (an absurdly long
  // credit under a tiny photograph) is it trimmed.
  const fits = best.fits.map((f, i) => {
    const text = texts[i];
    if (f || !text) return f;
    ctx.font = style.creditFont(MIN_CREDIT_PX);
    return { px: MIN_CREDIT_PX, lines: [fitLine(ctx, text, placed[i].w)] };
  });

  ready.forEach(({ rec, img }, i) => {
    const { x, y, w, h } = placed[i];
    ctx.drawImage(img, x, y, w, h);

    // Labels sit under the photograph, as wide as it is.
    let ty = y + h;
    if (labelPx) {
      ctx.font = style.labelFont(labelPx);
      ctx.fillStyle = style.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      let line = rec.name;
      while (line.length > 6 && ctx.measureText(line).width > w) line = line.slice(0, -2);
      if (line !== rec.name) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, x + w / 2, ty + labelPx * 0.25);
      ty += labelPx * 1.5;
    }
    const fit = fits[i];
    if (credPx && fit && fit.lines.length) {
      ctx.font = style.creditFont(fit.px);
      ctx.fillStyle = style.at;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      fit.lines.forEach((line, k) =>
        ctx.fillText(line, x + w / 2, ty + credPx * 0.2 + k * fit.px * 1.25),
      );
    }
  });
}
