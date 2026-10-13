/**
 * Flag colours — drawing the pie (or ring) chart of a flag's colours.
 */

import { safeColour } from "../../shared/colour.js";
import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {boolean} transparent
 * @property {boolean} percent label each slice with its share
 * @property {boolean} hex label each slice with its hex code (reveals)
 * @property {boolean} ring draw a ring rather than a pie
 * @property {boolean} country print the country's name (reveals)
 * @property {number} start angle of the first slice, in degrees from 12 o'clock
 * @property {string} caption
 * @property {boolean} capTop
 */

/**
 * Black text on a pale slice, white on a dark one.
 *
 * @param {number[]} rgb
 * @returns {string}
 */
function readableOn(rgb) {
  /** @param {number} v */
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.42 ? "#111111" : "#ffffff";
}

/**
 * Draw the chart onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {{country: {name: string} | null, slices: import("./measure.js").Slice[]}} content
 */
export function drawSheet(canvas, opts, { country, slices }) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.round(Math.min(W, H) * 0.06);
  let top = pad;
  let bottom = H - pad;

  // Caption: shrunk until it fits the width.
  if (opts.caption) {
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let px = Math.round(H * 0.045);
    ctx.font = `600 ${px}px "Outfit", sans-serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Outfit", sans-serif`;
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
    ctx.font = `400 ${px}px "Outfit", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(country.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if (!slices.length) return;
  const boxH = bottom - top;
  const boxW = W - pad * 2;
  if (boxH < 30 || boxW < 30) return;

  const radius = Math.max(10, Math.min(boxW, boxH) / 2);
  const cx = W / 2;
  const cy = top + boxH / 2;
  const startAngle = ((opts.start % 360) * Math.PI) / 180 - Math.PI / 2;
  const labelPx = clamp(Math.round(radius * 0.085), 11, 46);

  let angle = startAngle;
  for (const s of slices) {
    const sweep = s.share * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = safeColour(s.colour, "#888888");
    ctx.fill();
    angle += sweep;
  }

  if (opts.ring) {
    // Punched out rather than painted over, so a transparent sheet stays
    // transparent in the middle.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!opts.transparent) {
      ctx.fillStyle = opts.bg;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (opts.percent || opts.hex) {
    angle = startAngle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const s of slices) {
      const sweep = s.share * Math.PI * 2;
      const mid = angle + sweep / 2;
      const r = opts.ring ? radius * 0.72 : radius * 0.62;
      const lines = [];
      if (opts.percent) lines.push(`${(s.share * 100).toFixed(1)}%`);
      if (opts.hex) lines.push(s.colour.toUpperCase());
      // A sliver has no room for a label; leaving it off beats overprinting.
      if (sweep > 0.16) {
        ctx.fillStyle = readableOn(s.rgb);
        lines.forEach((line, i) => {
          ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? labelPx : labelPx * 0.78}px "Outfit", sans-serif`;
          ctx.fillText(
            line,
            cx + Math.cos(mid) * r,
            cy + Math.sin(mid) * r + (i - (lines.length - 1) / 2) * labelPx * 1.05,
          );
        });
      }
      angle += sweep;
    }
  }
}
