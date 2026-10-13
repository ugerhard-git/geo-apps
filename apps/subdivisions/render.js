/**
 * Subdivision clouds — turning subdivisions into tags and drawing the sheet.
 */

import { safeColour } from "../../shared/colour.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { fitCloud, relativeSizes, tagFont } from "./cloud.js";
import { AREA_UNIT_NAME } from "./config.js";
import { applyAffix } from "./names.js";

/** @typedef {import("./wikidata.js").Subdivision} Subdivision */

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {boolean} transparent
 * @property {boolean} rotate turn some tags on their side (spiral layout)
 * @property {boolean} dropAffix drop the word every name repeats
 * @property {boolean} values print each figure in brackets
 * @property {boolean} country print the country's name (reveals)
 * @property {string} caption
 * @property {boolean} capTop
 */

/**
 * @typedef {object} SheetContent
 * @property {{name: string} | null} country
 * @property {Subdivision[]} picked the subdivisions to draw
 * @property {"population" | "area"} metric what sizes the tags
 * @property {boolean} weighted whether a complete measure exists to size by
 * @property {import("./names.js").Affix | null} affix
 * @property {"spiral" | "wrapped"} layout
 * @property {string[]} colours the palette
 */

/**
 * 1234567 → "1.2m"
 *
 * @param {number} v
 * @returns {string}
 */
const compact = (v) =>
  v >= 1e9
    ? (v / 1e9).toFixed(1) + "bn"
    : v >= 1e6
      ? (v / 1e6).toFixed(1) + "m"
      : v >= 1e3
        ? (v / 1e3).toFixed(0) + "k"
        : String(Math.round(v));

/**
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 * @returns {import("./cloud.js").Tag[]}
 */
function buildTags(opts, { picked, metric, weighted, affix, colours }) {
  const values = weighted
    ? picked.map((p) => /** @type {number} */ (p[metric]))
    : picked.map(() => 1);
  const labels = opts.dropAffix
    ? applyAffix(
        picked.map((p) => p.name),
        affix,
      )
    : picked.map((p) => p.name);
  const rels = relativeSizes(values);
  // Colour follows size rank, so a region keeps its colour as things redraw.
  const ranked = picked.map((p, i) => ({ p, i, v: values[i] })).sort((a, b) => b.v - a.v);
  /** @type {Map<number, string>} */
  const colourOf = new Map();
  ranked.forEach((r, rank) => colourOf.set(r.i, colours[rank % colours.length]));
  return picked.map((p, i) => ({
    text: opts.values ? `${labels[i]} (${compact(values[i])})` : labels[i],
    rel: rels[i],
    colour: colourOf.get(i) || "",
  }));
}

/**
 * Draw the cloud onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, content) {
  const { country, picked, metric, layout } = content;
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
    ctx.font = `500 ${px}px "Fraunces", Georgia, serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `500 ${px}px "Fraunces", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  // Small, but not so small it cannot be read: the figures mean nothing
  // without it, and "70.5k" under a region name is otherwise a riddle.
  if (opts.values && picked.length) {
    const px = clamp(Math.round(H * 0.024), 13, 30);
    const text =
      metric === "area"
        ? `Figures in brackets are area in ${AREA_UNIT_NAME}`
        : "Figures in brackets are population";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.66;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.0;
  }

  // The country's name, along the bottom.
  if (opts.country && country) {
    const px = Math.round(H * 0.03);
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if (!picked.length) return;
  const tags = buildTags(opts, content);
  const boxW = W - pad * 2;
  const boxH = bottom - top;
  if (boxW < 20 || boxH < 20) return;
  const placed = fitCloud(ctx, tags, boxW, boxH, layout, opts.rotate);
  if (!placed) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of placed) {
    ctx.save();
    ctx.translate(pad + t.x, top + t.y);
    if (t.rotated) ctx.rotate(-Math.PI / 2);
    ctx.font = tagFont(t.px);
    ctx.fillStyle = safeColour(t.colour, "#444444");
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
}
