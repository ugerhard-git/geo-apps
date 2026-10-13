/**
 * Outlines — drawing a country's or region's outline on the sheet.
 */

import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { boundsOf, projectSubject, transformPolys } from "./projection.js";

/** @typedef {import("./shapes.js").Polys} Polys */

/**
 * @typedef {object} SheetOptions
 * @property {string} line outline colour
 * @property {number} lineWidth 0 for no outline
 * @property {string} fill fill colour
 * @property {boolean} hole cut the shape out of the background instead of filling it
 * @property {string} bg background colour
 * @property {boolean} bgNone transparent background
 * @property {number} rotate degrees
 * @property {boolean} flipH
 * @property {boolean} flipV
 * @property {number} margin fraction of the frame left empty around the shape
 * @property {boolean} name print the name (reveals)
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} capColour colour of the caption, name and footnote
 * @property {string} footnote small print along the bottom edge
 */

/**
 * @typedef {object} SheetContent
 * @property {Polys | null} polys the subject, in degrees
 * @property {string} countryName the country's name ("" when none)
 * @property {string} label what "name" prints
 * @property {boolean} mainOnly keep only the mainland
 */

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
 * Draw the sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, { polys, countryName, label, mainOnly }) {
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

  /*
    A footnote belongs below everything else, so it claims the bottom edge
    before the caption and the name are placed.
  */
  if (opts.footnote) {
    const px = clamp(Math.round(H * 0.024), 12, 30);
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.6;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = px;
    ctx.font = `400 ${size}px "Space Grotesk", sans-serif`;
    while (size > 9 && ctx.measureText(opts.footnote).width > W - pad * 2) {
      size -= 1;
      ctx.font = `400 ${size}px "Space Grotesk", sans-serif`;
    }
    ctx.fillText(opts.footnote, W / 2, bottom - size * 0.6);
    ctx.globalAlpha = 1;
    bottom -= size * 2.0;
  }

  // Caption: shrunk until it fits the width.
  if (opts.caption) {
    ctx.fillStyle = opts.capColour;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let px = Math.round(H * 0.045);
    ctx.font = `500 ${px}px "Space Grotesk", sans-serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `500 ${px}px "Space Grotesk", sans-serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  // The name, along the bottom.
  if (opts.name && label) {
    const px = Math.round(H * 0.03);
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if (!polys) return;
  const flat = projectSubject(polys, mainOnly, countryName);
  const pivot = boundsOf(flat); // shared by the country and its regions
  if (!pivot) return;
  const shape = transformPolys(flat, opts.rotate, opts.flipH, opts.flipV, pivot);
  const b = boundsOf(shape);
  if (!b) return;
  const boxW = (W - pad * 2) * (1 - opts.margin);
  const boxH = (bottom - top) * (1 - opts.margin);
  if (boxW <= 4 || boxH <= 4) return;
  const scale = Math.min(boxW / (b.x1 - b.x0), boxH / (b.y1 - b.y0));
  const offX = W / 2 - ((b.x0 + b.x1) / 2) * scale;
  const offY = (top + bottom) / 2 + ((b.y0 + b.y1) / 2) * scale;
  // Latitude grows upward in the projection and downward on a canvas.
  /** @type {(x: number, y: number) => [number, number]} */
  const map = (x, y) => [x * scale + offX, offY - y * scale];

  /*
    A hole is made by erasing, not by painting: fill the background first,
    then cut the interior out of it, so whatever lies behind the image shows
    through while the background colour still holds outside the shape.
  */
  if (opts.hole) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    tracePath(ctx, shape, map);
    ctx.fill("evenodd"); // a country enclosing another keeps its hole
    ctx.restore();
  } else {
    ctx.fillStyle = opts.fill;
    tracePath(ctx, shape, map);
    ctx.fill("evenodd");
  }
  if (opts.lineWidth > 0) {
    ctx.strokeStyle = opts.line;
    ctx.lineWidth = Math.max(0.5, (opts.lineWidth * Math.min(W, H)) / 900);
    ctx.lineJoin = "round";
    tracePath(ctx, shape, map);
    ctx.stroke();
  }
}
