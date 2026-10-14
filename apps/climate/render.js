/**
 * Climate charts — drawing the climate chart on the sheet.
 *
 * Bars for precipitation, a line for temperature, and optionally a band from
 * the average daily low to the average daily high. With the Walter–Lieth
 * scale, 10 °C on the left lines up with 20 mm on the right, so months where
 * the bars dip below the line are dry months: a convention climatologists
 * and geography teachers read at a glance.
 */

import { frameSpec } from "../../shared/sheet.js";
import { clamp } from "../../shared/util.js";
import { CREDIT } from "./config.js";

/** @typedef {import("./climate.js").Normals} Normals */

/**
 * @typedef {object} SheetOptions
 * @property {boolean} imperial °F and inches instead of °C and mm
 * @property {boolean} walterLieth 10 °C = 20 mm (metric only)
 * @property {boolean} band draw the daily low–high band
 * @property {boolean} julyFirst start the year in July
 * @property {boolean} values print each month's figures
 * @property {boolean} axes print the axis figures
 * @property {string} tempColour
 * @property {string} rainColour
 * @property {string} ink colour of text and gridlines
 * @property {string} bg background colour
 * @property {boolean} bgNone transparent background
 * @property {boolean} name print the place (reveals)
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} footnote
 * @property {boolean} credit print the data credit in the corner
 */

/**
 * @typedef {object} SheetContent
 * @property {Normals | null} normals
 * @property {string} label what "name" prints
 */

export const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** @param {number} c */
export const toF = (c) => (c * 9) / 5 + 32;
/** @param {number} mm */
export const toIn = (mm) => mm / 25.4;

/**
 * Round tick marks covering [lo, hi]: steps of 1, 2 or 5 times a power of ten.
 *
 * @param {number} lo
 * @param {number} hi
 * @param {number} target roughly how many intervals
 * @returns {{lo: number, hi: number, step: number}}
 */
export function niceRange(lo, hi, target) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) || 10 * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

/** Above this much precipitation, the Walter–Lieth scale shrinks tenfold. */
export const WL_KNEE = 100;

/**
 * @typedef {object} Axes
 * @property {{lo: number, hi: number, step: number}} t the temperature axis, in display units
 * @property {number} tLabelMax highest temperature tick that is labelled
 * @property {(p: number) => number} pPos where a precipitation value sits, in temperature units
 * @property {number[]} pTicks precipitation values to label, in display units
 * @property {number | null} knee the precipitation where the scale changes (Walter–Lieth only)
 */

/**
 * The two axes. Precipitation is placed in temperature units, so everything
 * is drawn against one vertical scale.
 *
 * Walter–Lieth: 10 °C = 20 mm, 0 °C and 0 mm on the same line, and above
 * 100 mm the scale shrinks tenfold (10 °C = 200 mm), as in the original
 * diagrams, so a monsoon month doesn't stretch the chart to 200 °C.
 *
 * @param {Normals} n
 * @param {{imperial: boolean, walterLieth: boolean, band: boolean}} o
 * @returns {Axes}
 */
export function axesFor(n, o) {
  const conv = o.imperial ? toF : (/** @type {number} */ c) => c;
  const pconv = o.imperial ? toIn : (/** @type {number} */ mm) => mm;
  const temps = [...n.mean, ...(o.band ? [...n.high, ...n.low] : [])]
    .filter((v) => v !== null)
    .map((v) => conv(/** @type {number} */ (v)));
  const rains = n.precip.filter((v) => v !== null).map((v) => pconv(/** @type {number} */ (v)));
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const pMax = Math.max(0, ...rains);

  if (o.walterLieth && !o.imperial) {
    /** @param {number} p */
    const pPos = (p) => (p <= WL_KNEE ? p / 2 : WL_KNEE / 2 + (p - WL_KNEE) / 20);
    const lo = Math.min(0, Math.floor(tMin / 10) * 10);
    const tTop = Math.max(10, Math.ceil(tMax / 10) * 10);
    const hi = Math.max(tTop, Math.ceil(pPos(pMax) / 10) * 10);
    /** @type {number[]} */
    const pTicks = [];
    for (let v = 0; v <= hi + 1e-9; v += 10)
      pTicks.push(v <= WL_KNEE / 2 ? v * 2 : WL_KNEE + (v - WL_KNEE / 2) * 20);
    return {
      t: { lo, hi, step: 10 },
      tLabelMax: tTop,
      pPos,
      pTicks,
      knee: pMax > WL_KNEE ? WL_KNEE : null,
    };
  }
  const t = niceRange(tMin - 1, tMax + 1, 5);
  const p = niceRange(0, pMax * 1.05 || 1, 5);
  /** @param {number} v */
  const pPos = (v) => t.lo + (v / p.hi) * (t.hi - t.lo);
  /** @type {number[]} */
  const pTicks = [];
  for (let v = 0; v <= p.hi + 1e-9; v += p.step) pTicks.push(v);
  return { t, tLabelMax: t.hi, pPos, pTicks, knee: null };
}

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
 * @param {number} v
 * @param {number} step the axis step, which decides the decimals
 */
const fmt = (v, step) => {
  const d = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (Math.abs(v) < 1e-9 ? 0 : v).toFixed(d).replace("-", "−");
};

/**
 * Draw the sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, { normals, label }) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, W, H);
  const S = Math.min(W, H);
  const pad = Math.round(S * 0.055);
  let top = pad;
  let bottom = H - pad;
  if (!opts.bgNone) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (opts.credit) {
    const px = clamp(Math.round(H * 0.016), 9, 20);
    ctx.fillStyle = opts.ink;
    ctx.globalAlpha = 0.45;
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(CREDIT, W - px, H - px);
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
    bottom = Math.min(bottom, H - px * 2.4);
  }
  if (opts.footnote) {
    ctx.fillStyle = opts.ink;
    ctx.globalAlpha = 0.65;
    const size = fitFont(ctx, opts.footnote, clamp(H * 0.026, 12, 34), 9, 400, W - pad * 2);
    ctx.fillText(opts.footnote, W / 2, bottom - size * 0.6);
    ctx.globalAlpha = 1;
    bottom -= size * 2.0;
  }
  if (opts.caption) {
    ctx.fillStyle = opts.ink;
    const px = fitFont(ctx, opts.caption, H * 0.045, 14, 500, W - pad * 2);
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }
  if (opts.name && label) {
    const px = Math.round(H * 0.03);
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = opts.ink;
    ctx.globalAlpha = 0.7;
    ctx.fillText(label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }
  if (!normals) return;

  const ax = axesFor(normals, opts);
  const order = Array.from({ length: 12 }, (_, i) => (opts.julyFirst ? (i + 6) % 12 : i));
  const tc = opts.imperial ? toF : (/** @type {number} */ c) => c;
  const pc = opts.imperial ? toIn : (/** @type {number} */ mm) => mm;

  // The plot area leaves room for the axis figures and the month initials.
  const labelPx = clamp(Math.round(S * 0.026), 10, 40);
  const unitPx = Math.round(labelPx * 0.9);
  const side = opts.axes ? labelPx * 3.6 : labelPx * 0.8;
  const x0 = Math.max(pad, (W - S * 1.5) / 2) + side;
  const x1 = W - Math.max(pad, (W - S * 1.5) / 2) - side;
  const y0 = top + (opts.axes ? unitPx * 2.2 : labelPx * 0.6);
  const y1 = bottom - labelPx * 2.2;
  if (x1 - x0 < 40 || y1 - y0 < 40) return;
  const ty = (/** @type {number} */ v) => y1 - ((v - ax.t.lo) / (ax.t.hi - ax.t.lo)) * (y1 - y0);
  const py = (/** @type {number} */ v) => ty(ax.pPos(v));
  const slot = (x1 - x0) / 12;
  const cx = (/** @type {number} */ i) => x0 + slot * (i + 0.5);
  const line = Math.max(1.5, S / 320);

  // Gridlines on the temperature ticks.
  ctx.strokeStyle = opts.ink;
  ctx.lineWidth = Math.max(1, S / 1400);
  ctx.globalAlpha = 0.14;
  for (let v = ax.t.lo; v <= ax.t.hi + 1e-9; v += ax.t.step) {
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(ty(v)) + 0.5);
    ctx.lineTo(x1, Math.round(ty(v)) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // A firmer line at 0 °C (or 32 °F) when it is inside the range.
  const freeze = opts.imperial ? 32 : 0;
  if (freeze > ax.t.lo && freeze < ax.t.hi) {
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x0, ty(freeze));
    ctx.lineTo(x1, ty(freeze));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Precipitation bars.
  ctx.fillStyle = opts.rainColour;
  const barW = slot * 0.62;
  const base = py(0);
  const kneeY = ax.knee === null ? null : py(ax.knee);
  order.forEach((mo, i) => {
    const v = normals.precip[mo];
    if (v === null) return;
    const yTop = Math.max(y0, py(pc(v)));
    ctx.globalAlpha = 0.85;
    ctx.fillRect(cx(i) - barW / 2, yTop, barW, base - yTop);
    // The part drawn at the shrunken scale is solid, as Walter and Lieth drew it.
    if (kneeY !== null && yTop < kneeY) {
      ctx.globalAlpha = 1;
      ctx.fillRect(cx(i) - barW / 2, yTop, barW, kneeY - yTop);
    }
  });
  ctx.globalAlpha = 1;
  if (kneeY !== null) {
    ctx.save();
    ctx.strokeStyle = opts.rainColour;
    ctx.lineWidth = Math.max(1, S / 900);
    ctx.setLineDash([S / 160, S / 220]);
    ctx.beginPath();
    ctx.moveTo(x0, kneeY);
    ctx.lineTo(x1, kneeY);
    ctx.stroke();
    ctx.restore();
  }

  // The low–high band, then the mean line.
  /** @param {Array<number | null>} series */
  const pts = (series) =>
    order.map((mo, i) => {
      const v = series[mo];
      return v === null ? null : /** @type {[number, number]} */ ([cx(i), ty(tc(v))]);
    });
  if (opts.band) {
    const hi = pts(normals.high);
    const lo = pts(normals.low);
    if (hi.every(Boolean) && lo.every(Boolean)) {
      ctx.beginPath();
      hi.forEach((p, i) =>
        i ? ctx.lineTo(...p) : ctx.moveTo(.../** @type {[number, number]} */ (p)),
      );
      for (let i = 11; i >= 0; i--) ctx.lineTo(.../** @type {[number, number]} */ (lo[i]));
      ctx.closePath();
      ctx.fillStyle = opts.tempColour;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  const mean = pts(normals.mean);
  ctx.strokeStyle = opts.tempColour;
  ctx.lineWidth = line * 1.6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let started = false;
  for (const p of mean) {
    if (!p) {
      started = false;
      continue;
    }
    if (started) ctx.lineTo(...p);
    else ctx.moveTo(...p);
    started = true;
  }
  ctx.stroke();
  ctx.fillStyle = opts.tempColour;
  for (const p of mean) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], line * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Month initials.
  ctx.fillStyle = opts.ink;
  ctx.font = `500 ${labelPx}px "Space Grotesk", sans-serif`;
  ctx.textAlign = "center";
  order.forEach((mo, i) => ctx.fillText(MONTHS[mo], cx(i), y1 + labelPx * 1.1));

  if (opts.values) {
    const vPx = Math.round(labelPx * 0.72);
    ctx.font = `500 ${vPx}px "Space Grotesk", sans-serif`;
    // A halo in the background colour keeps figures readable over bars and the band.
    ctx.lineJoin = "round";
    ctx.lineWidth = vPx * 0.3;
    ctx.strokeStyle = opts.bgNone ? "rgba(0,0,0,0.6)" : opts.bg;
    /** @param {string} text @param {number} x @param {number} y */
    const label = (text, x, y) => {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    order.forEach((mo, i) => {
      const t = normals.mean[mo];
      const p = normals.precip[mo];
      if (t !== null) {
        ctx.fillStyle = opts.tempColour;
        label(fmt(tc(t), 0.5), cx(i), ty(tc(t)) - line * 2.2 - vPx);
      }
      if (p !== null) {
        ctx.fillStyle = opts.ink;
        ctx.globalAlpha = 0.75;
        const yTop = Math.max(y0, py(pc(p)));
        ctx.fillText(
          fmt(pc(p), opts.imperial ? 0.1 : 1),
          cx(i),
          Math.min(base - vPx * 0.8, yTop + vPx * 0.9),
        );
        ctx.globalAlpha = 1;
      }
    });
  }

  if (opts.axes) {
    ctx.font = `400 ${Math.round(labelPx * 0.85)}px "Space Grotesk", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = opts.tempColour;
    for (let v = ax.t.lo; v <= ax.tLabelMax + 1e-9; v += ax.t.step)
      ctx.fillText(fmt(v, ax.t.step), x0 - labelPx * 0.5, ty(v));
    ctx.textAlign = "left";
    ctx.fillStyle = opts.rainColour;
    const pStep = ax.pTicks.length > 1 ? ax.pTicks[1] - ax.pTicks[0] : 1;
    for (const v of ax.pTicks) ctx.fillText(fmt(v, pStep), x1 + labelPx * 0.5, py(v));
    ctx.font = `500 ${unitPx}px "Space Grotesk", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = opts.tempColour;
    ctx.fillText(opts.imperial ? "°F" : "°C", x0 - labelPx * 0.5, y0 - unitPx * 1.4);
    ctx.textAlign = "left";
    ctx.fillStyle = opts.rainColour;
    ctx.fillText(opts.imperial ? "in" : "mm", x1 + labelPx * 0.5, y0 - unitPx * 1.4);
  }
}
