/**
 * Endemic animals — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { fitLine } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { fitCredit } from "./credits.js";
import { justifiedRows } from "./layout.js";

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

/** Most lines a photo credit may wrap onto. */
const MAX_CREDIT_LINES = 4;
/** Smallest credit font, in sheet pixels, before a credit is trimmed instead. */
const MIN_CREDIT_PX = 6;

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
  // Every photograph keeps its own shape (see layout.js).
  const texts = ready.map(({ rec }) => (rec.licence.attribution ? creditText(rec) : null));
  const readablePx = Math.max(8, Math.round(credPx * 0.7));
  /** @param {string} t @param {number} px */
  const measureAt = (t, px) => {
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    return ctx.measureText(t).width;
  };
  const box = { x: pad, y: top, w: boxW, h: boxH };
  /** @typedef {{px: number, lines: string[]} | null} Fit */
  /** @type {{placed: import("./layout.js").Placed[], fits: Fit[], worst: number} | null} */
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
    ctx.font = `400 ${MIN_CREDIT_PX}px "Inter", sans-serif`;
    return { px: MIN_CREDIT_PX, lines: [fitLine(ctx, text, placed[i].w)] };
  });

  ready.forEach(({ rec, img }, i) => {
    const { x, y, w, h } = placed[i];
    ctx.drawImage(img, x, y, w, h);

    // Labels sit under the photograph, as wide as it is.
    let ty = y + h;
    if (labelPx) {
      ctx.font = `italic 500 ${labelPx}px "Lora", Georgia, serif`;
      ctx.fillStyle = opts.fg;
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
      ctx.font = `400 ${fit.px}px "Inter", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      fit.lines.forEach((line, k) =>
        ctx.fillText(line, x + w / 2, ty + credPx * 0.2 + k * fit.px * 1.25),
      );
    }
  });
}
