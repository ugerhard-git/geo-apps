/**
 * Rivers — drawing the sheet.
 */

import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/projection.js").Box} Box */
/** @typedef {import("./clip.js").Piece} Piece */
/** @typedef {import("./data.js").Lake} Lake */

/**
 * @typedef {object} SheetOptions
 * @property {string} water colour of rivers and lakes
 * @property {number} weight 0.3–3, multiplies the line widths
 * @property {boolean} lakes fill lakes (otherwise rivers run through them as lines)
 * @property {boolean} outline draw the country's outline faintly
 * @property {string} bg background colour
 * @property {boolean} bgNone transparent background
 * @property {number} margin fraction of the frame left empty around the map
 * @property {boolean} name print the name (reveals)
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} capColour colour of the caption, name and footnote
 * @property {string} footnote small print along the bottom edge
 */

/**
 * @typedef {object} SheetContent
 * @property {Polys} shape the country in plane coordinates
 * @property {Box | null} frame what the map has to show
 * @property {Piece[]} pieces the rivers, clipped to the country
 * @property {Array<{lake: Lake, shift: number}>} lakes lakes that touch the country
 * @property {string} label what "name" prints
 */

/**
 * How thick a river is, relative to the greatest: Natural Earth ranks rivers
 * from 0 (the Amazon, the Nile) to 12 (a stream on a regional map).
 *
 * @param {number} rank
 */
export const rankWidth = (rank) => 0.12 + 0.88 * Math.pow(clamp((12 - rank) / 12, 0, 1), 1.6);

/**
 * Text shrunk until it fits the width.
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
  ctx.font = `${weight} ${size}px "Space Grotesk", sans-serif`;
  while (size > minPx && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px "Space Grotesk", sans-serif`;
  }
  return size;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Polys} polys
 * @param {(x: number, y: number) => [number, number]} map
 */
function traceShape(ctx, polys, map) {
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

  const ext = content.frame;
  if (!ext || !(ext.x1 > ext.x0) || !(ext.y1 > ext.y0)) return;
  const boxW = (W - pad * 2) * (1 - opts.margin);
  const boxH = (bottom - top) * (1 - opts.margin);
  if (boxW <= 4 || boxH <= 4) return;
  const scale = Math.min(boxW / (ext.x1 - ext.x0), boxH / (ext.y1 - ext.y0));
  const offX = W / 2 - ((ext.x0 + ext.x1) / 2) * scale;
  const offY = (top + bottom) / 2 + ((ext.y0 + ext.y1) / 2) * scale;
  /** @type {(x: number, y: number) => [number, number]} */
  const map = (x, y) => [x * scale + offX, offY - y * scale];
  const unit = (Math.min(W, H) / 260) * opts.weight; // width of the greatest river

  if (opts.outline && content.shape.length) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = opts.water;
    ctx.lineWidth = Math.max(1, Math.min(W, H) / 800);
    ctx.lineJoin = "round";
    ctx.beginPath();
    traceShape(ctx, content.shape, map);
    ctx.stroke();
    ctx.restore();
  }

  // Lakes are cut to the border: a lake the country shares shows only its half.
  if (opts.lakes && content.lakes.length && content.shape.length) {
    ctx.save();
    ctx.beginPath();
    traceShape(ctx, content.shape, map);
    ctx.clip("evenodd");
    ctx.beginPath();
    for (const { lake, shift } of content.lakes)
      for (const ring of lake.rings) {
        for (let i = 0; i < ring.length; i += 2) {
          const [px, py] = map(ring[i] + shift, ring[i + 1]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    ctx.fillStyle = opts.water;
    ctx.fill("evenodd");
    ctx.restore();
  }

  ctx.strokeStyle = opts.water;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Thin rivers first, so the great ones run over their tributaries.
  const order = [...content.pieces].sort((a, b) => b.rank - a.rank);
  for (const p of order) {
    if (opts.lakes && p.kind === "lake") continue; // the lake itself is drawn
    ctx.lineWidth = Math.max(0.6, unit * rankWidth(p.rank));
    ctx.setLineDash(p.kind === "intermittent" ? [ctx.lineWidth * 3, ctx.lineWidth * 2.5] : []);
    ctx.beginPath();
    for (let i = 0; i < p.xy.length; i += 2) {
      const [px, py] = map(p.xy[i], p.xy[i + 1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}
