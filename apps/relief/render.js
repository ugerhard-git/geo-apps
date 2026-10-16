/**
 * Shaded relief — laying out and drawing the sheet.
 *
 * Three steps, so that main.js can fetch tiles in between:
 *   planSheet     where the caption, name and credit go, and where the map
 *                 sits (this decides which tiles are needed)
 *   prepareRelief heights, the country mask and the shading for that map
 *   drawSheet     colours the relief and draws everything
 * The preview and the export run the same steps.
 */

import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { MAX_RELIEF_PIXELS } from "./config.js";
import {
  autoExaggeration,
  blurMask,
  colourise,
  heightColour,
  hillshade,
  lowestEdgeHeight,
  rgbOf,
  rowMetres,
  sampleHeights,
  slopeQuantile,
  worldPx,
} from "./terrain.js";

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/projection.js").Box} Box */
/** @typedef {import("./terrain.js").RGB} RGB */

/** "outline": the country on the background; "blend": its edge fades into
 *  ground-coloured background; "neighbours": the terrain around it too. */
/** @typedef {"outline" | "blend" | "neighbours"} Mode */

/**
 * @typedef {object} SheetOptions
 * @property {Mode} mode
 * @property {string} land ground colour (when not coloured by height)
 * @property {string} shadow
 * @property {string} light
 * @property {string} bg background, in the "outline" mode and around the map
 * @property {boolean} byHeight colour the ground by its height
 * @property {number} relief 0.5–2, multiplies the automatic exaggeration
 * @property {number} margin fraction of the frame left empty around the country
 * @property {boolean} name print the name (reveals)
 * @property {string} label the name to print
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} capColour colour of the caption, name and credit
 * @property {string} credit the credit line, "" for none
 */

/**
 * @typedef {object} Plan
 * @property {number} W
 * @property {number} H
 * @property {{x: number, y: number, w: number, h: number}} area where the map is drawn
 * @property {number} scale sheet pixels per plane unit
 * @property {number} offX sheet x of plane x = 0
 * @property {number} offY sheet y of plane y = 0
 * @property {Array<{text: string, y: number, px: number, weight: number, alpha: number}>} texts
 */

const FONT = '"Space Grotesk", sans-serif';

/**
 * The largest font size, down to `minPx`, at which `text` fits `maxW`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} px
 * @param {number} minPx
 * @param {number} weight
 * @param {number} maxW
 */
function fitFont(ctx, text, px, minPx, weight, maxW) {
  let size = Math.round(px);
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > minPx && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

/**
 * Where everything goes on the sheet.
 *
 * @param {CanvasRenderingContext2D} ctx for measuring text
 * @param {SheetOptions} opts
 * @param {Box} frame the part of the plane the country fills
 * @returns {Plan}
 */
export function planSheet(ctx, opts, frame) {
  const { W, H } = frameSpec();
  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad;
  let bottom = H - pad;
  /** @type {Plan["texts"]} */
  const texts = [];
  if (opts.credit) {
    const px = fitFont(ctx, opts.credit, clamp(H * 0.018, 10, 26), 8, 400, W - pad * 2);
    texts.push({ text: opts.credit, y: H - pad * 0.5, px, weight: 400, alpha: 0.6 });
  }
  if (opts.caption) {
    const px = fitFont(ctx, opts.caption, H * 0.045, 14, 500, W - pad * 2);
    if (opts.capTop) {
      texts.push({ text: opts.caption, y: top + px * 0.6, px, weight: 500, alpha: 1 });
      top += px * 1.9;
    } else {
      texts.push({ text: opts.caption, y: bottom - px * 0.6, px, weight: 500, alpha: 1 });
      bottom -= px * 1.9;
    }
  }
  if (opts.name && opts.label) {
    const px = Math.round(H * 0.03);
    texts.push({ text: opts.label, y: bottom - px * 0.7, px, weight: 400, alpha: 0.75 });
    bottom -= px * 2.1;
  }
  const area = { x: pad, y: top, w: Math.max(1, W - pad * 2), h: Math.max(1, bottom - top) };
  const boxW = area.w * (1 - opts.margin);
  const boxH = area.h * (1 - opts.margin);
  const scale = Math.max(
    1e-9,
    Math.min(boxW / (frame.x1 - frame.x0), boxH / (frame.y1 - frame.y0)),
  );
  const offX = W / 2 - ((frame.x0 + frame.x1) / 2) * scale;
  const offY = area.y + area.h / 2 + ((frame.y0 + frame.y1) / 2) * scale;
  return { W, H, area, scale, offX, offY, texts };
}

/**
 * How far the blended edge fades, in sheet pixels.
 *
 * @param {Plan} plan
 */
export const fadeOf = (plan) => Math.max(2, Math.min(plan.area.w, plan.area.h) * 0.004);

/**
 * The part of the plane whose heights the sheet needs: the whole map area
 * when the neighbours show, otherwise the country and the width of its
 * faded edge.
 *
 * @param {Plan} plan
 * @param {Box} frame
 * @param {Mode} mode
 * @returns {Box}
 */
export function neededBox(plan, frame, mode) {
  const { area, scale, offX, offY } = plan;
  const shown = {
    x0: (area.x - offX) / scale,
    x1: (area.x + area.w - offX) / scale,
    y0: (offY - area.y - area.h) / scale,
    y1: (offY - area.y) / scale,
  };
  if (mode === "neighbours") return shown;
  const m = (fadeOf(plan) * 3) / scale;
  return {
    x0: Math.max(shown.x0, frame.x0 - m),
    x1: Math.min(shown.x1, frame.x1 + m),
    y0: Math.max(shown.y0, frame.y0 - m),
    y1: Math.min(shown.y1, frame.y1 + m),
  };
}

/**
 * @typedef {object} Relief
 * @property {number} w raster columns
 * @property {number} h raster rows
 * @property {Float32Array} heights
 * @property {Uint8Array} mask the country, 0–255
 * @property {Uint8Array} faded the mask with its edge softened
 * @property {Float32Array} shade
 * @property {number} lowest height of the lowest ground along the country's edge
 */

/**
 * Heights, mask and shading for the map area, at the sheet's resolution
 * (or less, for very large sheets).
 *
 * @param {Plan} plan
 * @param {Polys} shape the country in the plane
 * @param {number} z zoom of the tiles
 * @param {(key: string) => Float32Array | null | undefined} tileAt
 * @param {number} relief multiplies the automatic exaggeration
 * @returns {Relief}
 */
export function prepareRelief(plan, shape, z, tileAt, relief) {
  const { area, scale, offX, offY } = plan;
  const f = Math.min(1, Math.sqrt(MAX_RELIEF_PIXELS / (area.w * area.h)));
  const w = Math.max(1, Math.round(area.w * f));
  const h = Math.max(1, Math.round(area.h * f));

  // Raster pixel → plane → world pixel is a straight scaling, so the grid
  // needs only its first pixel and its step.
  const toPlaneX = (/** @type {number} */ i) => (area.x + (i + 0.5) / f - offX) / scale;
  const toPlaneY = (/** @type {number} */ j) => (offY - area.y - (j + 0.5) / f) / scale;
  const [X0, Y0] = worldPx(toPlaneX(0), toPlaneY(0), z);
  const [X1] = worldPx(toPlaneX(1), toPlaneY(0), z);
  const grid = { w, h, z, X0, Y0, step: X1 - X0 };

  const mask = maskOf(shape, w, h, (x, y) => [
    (x * scale + offX - area.x) * f,
    (offY - y * scale - area.y) * f,
  ]);
  const heights = sampleHeights(grid, tileAt);
  // The tiles include the sea floor; outside the country it is drawn as
  // flat water, so a coast shows only where the land rises from it.
  for (let k = 0; k < heights.length; k++) if (mask[k] < 128 && heights[k] < 0) heights[k] = 0;

  const metres = rowMetres(grid);
  const steep = slopeQuantile(heights, w, h, metres, mask, 0.95);
  const shade = hillshade(heights, w, h, metres, autoExaggeration(steep) * relief);
  const faded = blurMask(mask, w, h, fadeOf(plan) * f);
  return { w, h, heights, mask, faded, shade, lowest: lowestEdgeHeight(heights, mask, w, h) };
}

/**
 * The country drawn as a 0–255 mask.
 *
 * @param {Polys} shape
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => [number, number]} map plane → raster
 * @returns {Uint8Array}
 */
function maskOf(shape, w, h, map) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (
    c.getContext("2d", { willReadFrequently: true })
  );
  ctx.beginPath();
  for (const rings of shape)
    for (const ring of rings) {
      ring.forEach(([x, y], i) => {
        const [px, py] = map(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
  ctx.fillStyle = "#fff";
  ctx.fill("evenodd");
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let k = 0; k < out.length; k++) out[k] = rgba[k * 4 + 3];
  return out;
}

/**
 * The background the sheet gets: the chosen one, or in the blended mode
 * the colour of the country's lowest edge, so that its outline disappears
 * wherever the border runs through flat ground.
 *
 * @param {SheetOptions} opts
 * @param {Relief | null} relief
 * @returns {RGB}
 */
export function backgroundOf(opts, relief) {
  if (opts.mode !== "blend") return rgbOf(opts.bg);
  if (opts.byHeight) return heightColour(relief ? relief.lowest : 0).map(Math.round);
  return rgbOf(opts.land);
}

/**
 * Draw the sheet onto `canvas`, resizing it to the plan.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {Plan} plan
 * @param {Relief} relief
 */
export function drawSheet(canvas, opts, plan, relief) {
  const { W, H, area } = plan;
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const bg = backgroundOf(opts, relief);
  ctx.fillStyle = `rgb(${bg.join(",")})`;
  ctx.fillRect(0, 0, W, H);

  const img = new ImageData(relief.w, relief.h);
  colourise(img.data, relief.shade, relief.heights, maskFor(opts.mode, relief), {
    land: rgbOf(opts.land),
    shadow: rgbOf(opts.shadow),
    light: rgbOf(opts.light),
    bg,
    byHeight: opts.byHeight,
    contrast: 1,
  });
  if (relief.w === Math.round(area.w) && relief.h === Math.round(area.h)) {
    ctx.putImageData(img, Math.round(area.x), Math.round(area.y));
  } else {
    // A reduced raster for a very large sheet: scaled up smoothly.
    const tmp = document.createElement("canvas");
    tmp.width = relief.w;
    tmp.height = relief.h;
    /** @type {CanvasRenderingContext2D} */ (tmp.getContext("2d")).putImageData(img, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tmp, area.x, area.y, area.w, area.h);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts.capColour;
  for (const t of plan.texts) {
    ctx.font = `${t.weight} ${t.px}px ${FONT}`;
    ctx.globalAlpha = t.alpha;
    ctx.fillText(t.text, W / 2, t.y);
  }
  ctx.globalAlpha = 1;
}

/**
 * @param {Mode} mode
 * @param {Relief} relief
 */
function maskFor(mode, relief) {
  if (mode === "neighbours") return null;
  return mode === "blend" ? relief.faded : relief.mask;
}
