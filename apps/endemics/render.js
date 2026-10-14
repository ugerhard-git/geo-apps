/**
 * Endemic animals — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { fitLine } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
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
  const aspects = ready.map(({ img }) => {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    return iw / ih;
  });
  // Every photograph keeps its own shape: nothing is cropped (see layout.js).
  const placed = justifiedRows(aspects, { x: pad, y: top, w: boxW, h: boxH }, gap, extra);
  if (!placed.length) return;

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
      ctx.fillText(fitLine(ctx, bits.join(" · "), w), x + w / 2, ty + credPx * 0.2);
    }
  });
}
