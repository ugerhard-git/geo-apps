/**
 * City dots — drawing the sheet.
 */

import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { MAINLAND_SLACK_DEG } from "./config.js";
import { extentOf, pickDots, radiusFor, subject } from "./dots.js";

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("./cities.js").City} City */

/**
 * @typedef {object} SheetOptions
 * @property {number} count how many cities
 * @property {boolean} equal all dots the same size instead of sized by population
 * @property {number} dotScale 0.3–2, multiplies the dot size
 * @property {string} dot dot colour
 * @property {boolean} outline draw the country's outline faintly
 * @property {boolean} capital ring the capital
 * @property {string} bg background colour
 * @property {boolean} bgNone transparent background
 * @property {number} margin fraction of the frame left empty around the map
 * @property {boolean} name print the name (reveals)
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} capColour colour of the caption, name, footnote and rings
 * @property {string} footnote small print along the bottom edge
 * @property {boolean} credit print the data credit in the corner
 */

/**
 * @typedef {object} SheetContent
 * @property {Polys | null} polys the country's outline in degrees, if there is one
 * @property {string} shapeName its Natural Earth name, for the mainland rules
 * @property {City[] | null} cities the country's cities, largest first (null while loading)
 * @property {string} label what "name" prints
 * @property {boolean} mainOnly keep only the mainland
 */

export const CREDIT = "Cities: GeoNames, CC BY 4.0";

/**
 * Which dots end up on the sheet — exported so the page can describe them.
 *
 * @param {SheetContent} content
 * @param {number} count
 * @param {boolean} withCapital
 */
export function dotsFor({ polys, shapeName, cities, mainOnly }, count, withCapital) {
  const { shape, boxes } = subject(polys, mainOnly, shapeName);
  const dots = cities ? pickDots(cities, count, boxes, MAINLAND_SLACK_DEG, withCapital) : [];
  return { shape, boxes, dots };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Polys} polys
 * @param {(x: number, y: number) => [number, number]} map plane to canvas
 */
function tracePath(ctx, polys, map) {
  ctx.beginPath();
  for (const rings of polys)
    for (const ring of rings) {
      ring.forEach(([x, y], i) => {
        const [px, py] = map(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
}

/**
 * Text shrunk until it fits the width.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} px starting size
 * @param {number} minPx
 * @param {number} weight
 * @param {number} maxW
 * @returns {number} the size used (the font is left set)
 */
function fitFont(ctx, text, px, minPx, weight, maxW) {
  let size = Math.round(px);
  ctx.font = `${weight} ${size}px "Space Grotesk", sans-serif`;
  while (size > minPx && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px "Space Grotesk", sans-serif`;
  }
  return size;
}

/**
 * Draw the sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 * @returns {number} how many dots were drawn
 */
export function drawSheet(canvas, opts, content) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, W, H);
  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad;
  let bottom = H - pad;
  if (!opts.bgNone) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // The data credit sits in the bottom-right corner, below everything else.
  if (opts.credit) {
    const px = clamp(Math.round(H * 0.016), 9, 20);
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.45;
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(CREDIT, W - px, H - px);
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
    bottom = Math.min(bottom, H - px * 2.4);
  }

  if (opts.footnote) {
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.6;
    const size = fitFont(ctx, opts.footnote, clamp(H * 0.024, 12, 30), 9, 400, W - pad * 2);
    ctx.fillText(opts.footnote, W / 2, bottom - size * 0.6);
    ctx.globalAlpha = 1;
    bottom -= size * 2.0;
  }

  if (opts.caption) {
    ctx.fillStyle = opts.capColour;
    const px = fitFont(ctx, opts.caption, H * 0.045, 14, 500, W - pad * 2);
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  if (opts.name && content.label) {
    const px = Math.round(H * 0.03);
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.7;
    ctx.fillText(content.label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  const { shape, boxes, dots } = dotsFor(content, opts.count, opts.capital);
  const ext = extentOf(boxes, dots);
  if (!ext) return 0;

  // Dots poke out past the points they mark, so the map box leaves room for them.
  const rMax = clamp(Math.min(W, H) * 0.045 * opts.dotScale, 3, 400);
  const boxW = (W - pad * 2) * (1 - opts.margin) - rMax * 2;
  const boxH = (bottom - top) * (1 - opts.margin) - rMax * 2;
  if (boxW <= 4 || boxH <= 4) return 0;
  const scale = Math.min(boxW / (ext.x1 - ext.x0), boxH / (ext.y1 - ext.y0));
  const offX = W / 2 - ((ext.x0 + ext.x1) / 2) * scale;
  const offY = (top + bottom) / 2 + ((ext.y0 + ext.y1) / 2) * scale;
  /** @type {(x: number, y: number) => [number, number]} */
  const map = (x, y) => [x * scale + offX, offY - y * scale];

  if (opts.outline && shape.length) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = opts.dot;
    ctx.lineWidth = Math.max(1, Math.min(W, H) / 700);
    ctx.lineJoin = "round";
    tracePath(ctx, shape, map);
    ctx.stroke();
    ctx.restore();
  }

  const maxPop = dots.reduce((m, d) => Math.max(m, d.pop), 0);
  /*
    Largest first, so a small town next to a big city sits on top of it
    rather than disappearing underneath. A thin ring in the background colour
    keeps touching dots apart.
  */
  const ring = Math.max(1, rMax * 0.06);
  for (const d of dots) {
    const [px, py] = map(d.x, d.y);
    const r = radiusFor(d.pop, maxPop, rMax, opts.equal);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = opts.dot;
    ctx.fill();
    if (!opts.bgNone) {
      ctx.lineWidth = ring;
      ctx.strokeStyle = opts.bg;
      ctx.stroke();
    }
  }
  if (opts.capital) {
    for (const d of dots) {
      if (!d.capital) continue;
      const [px, py] = map(d.x, d.y);
      const r = radiusFor(d.pop, maxPop, rMax, opts.equal);
      ctx.beginPath();
      ctx.arc(px, py, r + ring * 2 + Math.max(2, rMax * 0.12), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, rMax * 0.08);
      ctx.strokeStyle = opts.capColour;
      ctx.stroke();
    }
  }
  return dots.length;
}
