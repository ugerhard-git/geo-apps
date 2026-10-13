/**
 * Licence plates — drawing the sheet.
 *
 * `drawSheet` is given everything it draws, so it can render the on-screen
 * preview and the export alike without reading any app state.
 */

import { blurInto, toCanvas } from "../../shared/blur.js";
import { drawImageGrid } from "../../shared/image-grid.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp, own } from "../../shared/util.js";
import { SECTION_LABEL, SECTION_ORDER, SHEET_FIELDS } from "./config.js";

/** @typedef {import("./commons-data.js").Plate} Plate */

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {string} at attribution colour
 * @property {boolean} transparent
 * @property {boolean} sections label each section
 * @property {boolean} country print the country's name (reveals the answer)
 * @property {boolean} spec print the plate requirements
 * @property {boolean} specTop requirements above (true) or below (false)
 * @property {string} caption
 * @property {boolean} capTop
 * @property {boolean} blurWhole blur whole plates rather than drawn regions
 * @property {number} blurAmount in tenths of a percent of the plate's width
 */

/**
 * @typedef {object} SheetContent
 * @property {{name: string} | null} country
 * @property {Plate[]} plates in the order chosen
 * @property {import("./plate-spec.js").PlateSpec | null} spec
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 */

/**
 * The requirement rows that are safe to print on a sheet.
 *
 * @param {import("./plate-spec.js").PlateSpec | null} spec
 */
export const specRowsForSheet = (spec) =>
  spec ? spec.rows.filter((r) => SHEET_FIELDS.includes(r.key)) : [];

/**
 * A blur at the very edge of an image has nothing outside to sample, so it
 * fades toward transparent and leaves a pale border. Padding the source with a
 * stretched copy of itself gives it something to pull in.
 *
 * @param {HTMLCanvasElement} src
 * @param {number} pad
 * @returns {HTMLCanvasElement}
 */
function paddedCopy(src, pad) {
  const c = document.createElement("canvas");
  c.width = src.width + pad * 2;
  c.height = src.height + pad * 2;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, c.width, c.height); // smear outward
  ctx.drawImage(src, 0, 0, src.width, src.height, pad, pad, src.width, src.height);
  return c;
}

/**
 * A plate as it will be drawn, with blur applied — to the whole plate, or to
 * the regions drawn in the editor.
 *
 * @param {HTMLImageElement} img
 * @param {Plate} rec
 * @param {SheetOptions} opts
 * @returns {HTMLCanvasElement}
 */
function renderPlate(img, rec, opts) {
  const base = toCanvas(img);
  const w = base.width;
  const h = base.height;

  const radius = (opts.blurAmount / 1000) * w;
  if (radius <= 0.5) return base;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext("2d"));
  ctx.drawImage(base, 0, 0); // start from the untouched image

  if (opts.blurWhole || !rec.regions.length) {
    const pad = Math.ceil(radius * 2);
    const padded = paddedCopy(base, pad);
    const tmp = document.createElement("canvas");
    tmp.width = padded.width;
    tmp.height = padded.height;
    /** @type {CanvasRenderingContext2D} */ (tmp.getContext("2d")).drawImage(padded, 0, 0);
    blurInto(tmp, padded, 0, 0, padded.width, padded.height, radius);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, pad, pad, w, h, 0, 0, w, h);
  } else {
    for (const r of rec.regions) {
      const rx = clamp(r.x, 0, 1) * w;
      const ry = clamp(r.y, 0, 1) * h;
      const rw = Math.min(clamp(r.w, 0, 1) * w, w - rx);
      const rh = Math.min(clamp(r.h, 0, 1) * h, h - ry);
      if (rw < 2 || rh < 2) continue;
      blurInto(out, base, Math.round(rx), Math.round(ry), Math.round(rw), Math.round(rh), radius);
    }
  }
  return out;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export async function drawSheet(canvas, opts, { country, plates, spec, loadImage }) {
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
    ctx.font = `600 ${px}px "Archivo Narrow", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const t = opts.caption;
    while (px > 14 && ctx.measureText(t).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Archivo Narrow", sans-serif`;
    }
    if (opts.capTop) {
      ctx.fillText(t, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(t, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  // Plate requirements, with their credit.
  if (opts.spec) {
    const rows = specRowsForSheet(spec);
    if (rows.length) {
      const px = clamp(Math.round(H * 0.022), 11, 30);
      const lines = rows.map((r) => `${r.label}: ${r.value}`);
      ctx.font = `400 ${px}px "Archivo", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

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

      const creditPx = Math.max(9, Math.round(px * 0.62));
      const blockH = packed.length * px * 1.45 + creditPx * 1.9;
      // Above sits under the caption; below sits above the country name.
      let ly = opts.specTop ? top + px * 0.9 : bottom - blockH + px * 0.9;
      ctx.fillStyle = opts.fg;
      ctx.globalAlpha = 0.85;
      for (const line of packed) {
        ctx.fillText(line, W / 2, ly);
        ly += px * 1.45;
      }
      ctx.globalAlpha = 1;

      ctx.font = `400 ${creditPx}px "Archivo", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.fillText("Plate data: English Wikipedia, CC BY-SA 4.0", W / 2, ly + creditPx * 0.2);

      if (opts.specTop) top += blockH + px * 0.5;
      else bottom -= blockH + px * 0.5;
    }
  }

  // The country's name, along the bottom.
  if (opts.country && country) {
    const px = Math.round(H * 0.03);
    ctx.font = `500 ${px}px "Archivo", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.name, W / 2, bottom - px * 0.7);
    bottom -= px * 1.9;
  }

  const groups = SECTION_ORDER.map((id) => ({
    id,
    items: plates.filter((s) => s.section === id),
  })).filter((g) => g.items.length);
  if (!groups.length) return;

  /*
    Blur once per plate, before layout: the grid is sized from the finished
    plate canvases, so blurring and arranging can't disagree about dimensions.
  */
  /** @type {Map<Plate, HTMLCanvasElement>} */
  const prepared = new Map();
  for (const rec of plates) {
    let img;
    try {
      img = await loadImage(rec.full);
    } catch {
      try {
        img = await loadImage(rec.thumb); // wider render unavailable
      } catch {
        continue;
      }
    }
    prepared.set(rec, renderPlate(img, rec, opts));
  }

  const bandH = (bottom - top) / groups.length;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const items = g.items.filter((r) => prepared.has(r));
    if (!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    if (opts.sections) {
      const hPx = clamp(Math.round(bandH * 0.13), 16, 46);
      ctx.font = `600 ${hPx}px "Archivo", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText(own(SECTION_LABEL, g.id) || "Plates", pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7;
    }

    drawImageGrid(ctx, items, prepared, pad, y, W - pad * 2, bandTop + bandH - y - bandH * 0.05, {
      creditColour: opts.at,
      creditFont: '"Archivo", sans-serif',
      maxCreditPx: 20,
      authorPrefix: "Photo: ",
    });
  }
}
