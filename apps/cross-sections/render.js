/**
 * Cross-sections — drawing the sheet: a caption, the line's description,
 * the profile with its axes, a footnote and a credit. The preview and the
 * export are drawn by the same function.
 */

/** @typedef {import("./profile.js").Profile} Profile */
/** @typedef {import("./profile.js").Scale} Scale */

/**
 * @typedef {object} SheetOptions
 * @property {number} W
 * @property {number} H
 * @property {string} bg background
 * @property {boolean} transparent no background: only the drawing and text
 * @property {string} ink text, lines and the profile's edge
 * @property {string} land the profile's fill
 * @property {string} caption "" for none
 * @property {string} subtitle the line's description ("West to east · 173 km"), "" for none
 * @property {string} footnote under the chart, "" for none
 * @property {[string, string] | null} ends labels at the line's start and end
 * @property {boolean} heights figures on the height axis
 * @property {boolean} distances figures on the distance axis
 * @property {string} credit "" for none
 */

const FONT = '"Space Grotesk", sans-serif';

/** Grid steps for the distance axis, in km. */
const KM_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** @param {number} n */
const thousands = (n) => Math.round(n).toLocaleString("en-GB");

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
function fitPx(ctx, text, px, minPx, weight, maxW) {
  let size = px;
  for (; size > minPx; size -= 1) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

/**
 * Draw the sheet.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} o
 * @param {Profile} profile
 * @param {Scale} scale
 */
export function drawSheet(canvas, o, profile, scale) {
  const { W, H } = o;
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const u = Math.min(W, H) / 1000;
  const padX = Math.max(W * 0.06, 24 * u);
  const maxText = W - 2 * padX;

  if (!o.transparent) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.textBaseline = "alphabetic";

  // Top: caption and the line's description.
  let y = H * 0.07;
  if (o.caption) {
    const px = fitPx(ctx, o.caption, Math.round(46 * u), Math.round(20 * u), 500, maxText);
    y += px;
    ctx.font = `500 ${px}px ${FONT}`;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.caption, W / 2, y);
    y += 14 * u;
  }
  if (o.subtitle) {
    const px = fitPx(ctx, o.subtitle, Math.round(27 * u), Math.round(14 * u), 400, maxText);
    y += px;
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.subtitle, W / 2, y);
    ctx.globalAlpha = 1;
  }
  const chartTop = y + 46 * u;

  // Bottom, from the edge up: credit, footnote, the axis labels.
  let bottom = H - H * 0.05;
  const smallPx = Math.round(17 * u);
  if (o.credit) {
    ctx.font = `400 ${smallPx}px ${FONT}`;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "right";
    ctx.fillText(o.credit, W - padX, bottom);
    ctx.globalAlpha = 1;
    bottom -= smallPx + 18 * u;
  }
  if (o.footnote) {
    const px = fitPx(ctx, o.footnote, Math.round(20 * u), Math.round(12 * u), 400, maxText);
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.footnote, W / 2, bottom);
    ctx.globalAlpha = 1;
    bottom -= px + 30 * u;
  }
  const tickPx = Math.round(20 * u);
  const endPx = Math.round(23 * u);
  if (o.ends) bottom -= endPx + 10 * u;
  if (o.distances) bottom -= tickPx + 12 * u;
  const chartBottom = bottom - 6 * u;

  // Left: the height figures, as wide as the widest needs.
  ctx.font = `400 ${tickPx}px ${FONT}`;
  // Grid lines on round heights (0, 1,000 m…), plus the floor when it isn't
  // one (−400 m beside the Dead Sea).
  /** @type {number[]} */
  const levels = [];
  // `|| 0` turns −0 into 0, which would otherwise print as "-0 m".
  const first = Math.ceil(scale.bottom / scale.step - 1e-9) * scale.step || 0;
  for (let v = first; v <= scale.top + 1e-6; v += scale.step) levels.push(v);
  if (scale.bottom < first) levels.unshift(scale.bottom);
  const labelW = o.heights
    ? Math.max(...levels.map((v) => ctx.measureText(`${thousands(v)} m`).width)) + 14 * u
    : 0;
  const left = padX + labelW;
  const right = W - padX;
  if (chartBottom - chartTop < 40 * u || right - left < 80 * u) return;

  const km = Math.max(profile.lengthKm, 1e-6);
  const X = (/** @type {number} */ d) => left + (d / km) * (right - left);
  const Y = (/** @type {number} */ m) =>
    chartBottom - ((m - scale.bottom) / (scale.top - scale.bottom)) * (chartBottom - chartTop);

  // Grid lines and height figures.
  ctx.lineWidth = Math.max(1, u);
  for (const v of levels) {
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.13;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(Y(v)) + 0.5);
    ctx.lineTo(right, Math.round(Y(v)) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (o.heights) {
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = o.ink;
      ctx.textAlign = "right";
      ctx.fillText(`${thousands(v)} m`, left - 14 * u, Y(v) + tickPx * 0.35);
      ctx.globalAlpha = 1;
    }
  }

  // The profile: each inside part filled down to the chart's floor.
  ctx.lineJoin = "round";
  for (const run of profile.runs) {
    ctx.beginPath();
    run.forEach(([d, m], i) => {
      const py = Y(Math.max(m, scale.bottom));
      if (i) ctx.lineTo(X(d), py);
      else ctx.moveTo(X(d), py);
    });
    const outline = new Path2D();
    run.forEach(([d, m], i) => {
      const py = Y(Math.max(m, scale.bottom));
      if (i) outline.lineTo(X(d), py);
      else outline.moveTo(X(d), py);
    });
    ctx.lineTo(X(run[run.length - 1][0]), chartBottom);
    ctx.lineTo(X(run[0][0]), chartBottom);
    ctx.closePath();
    ctx.fillStyle = o.land;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.ink;
    ctx.lineWidth = Math.max(1, 1.6 * u);
    ctx.stroke(outline);
  }

  // Sea level, where land goes below it: a dashed line, named.
  if (scale.bottom < 0 && scale.top > 0) {
    ctx.save();
    ctx.setLineDash([8 * u, 6 * u]);
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.moveTo(left, Y(0));
    ctx.lineTo(right, Y(0));
    ctx.stroke();
    ctx.restore();
    ctx.font = `400 ${Math.round(18 * u)}px ${FONT}`;
    ctx.fillStyle = o.ink;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "right";
    ctx.fillText("sea level", right - 6 * u, Y(0) - 8 * u);
    ctx.globalAlpha = 1;
  }

  // Below the chart: distances, then the compass at each end.
  let below = chartBottom + 6 * u;
  if (o.distances) {
    const step = KM_STEPS.find((s) => km / s <= 7) || 5000;
    ctx.font = `400 ${tickPx}px ${FONT}`;
    ctx.fillStyle = o.ink;
    ctx.globalAlpha = 0.62;
    below += tickPx + 6 * u;
    for (let d = 0; d <= km + 1e-6; d += step) {
      ctx.textAlign = d === 0 ? "left" : "center";
      if (X(d) > right - 40 * u && d > 0) break;
      ctx.fillText(`${thousands(d)} km`, X(d), below);
    }
    ctx.globalAlpha = 1;
  }
  if (o.ends) {
    below += endPx + 10 * u;
    ctx.font = `500 ${endPx}px ${FONT}`;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "left";
    ctx.fillText(o.ends[0], left, below);
    ctx.textAlign = "right";
    ctx.fillText(o.ends[1], right, below);
  }
}
