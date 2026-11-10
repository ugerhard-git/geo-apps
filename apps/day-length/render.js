/**
 * Day length — drawing the sheet, in one of two views:
 *   clock  day, twilight and night through the year, local clock time
 *          running up the chart, with the sunrise and sunset lines
 *   hours  the hours of daylight, day by day, as one curve
 * Both have a caption, a subtitle, a footnote and a credit. The preview and
 * the export are drawn by the same function.
 */

/** @typedef {import("./sun.js").Day} Day */

/**
 * @typedef {object} SheetOptions
 * @property {number} W
 * @property {number} H
 * @property {"clock" | "hours"} view
 * @property {string} bg background
 * @property {boolean} transparent no background: only the chart and text
 * @property {string} ink text
 * @property {string} day daylight
 * @property {string} twilight civil twilight
 * @property {string} night night
 * @property {string} line sunrise and sunset, or the daylight curve
 * @property {boolean} showTwilight draw the twilight band (clock view)
 * @property {boolean} showLines draw the sunrise and sunset lines (clock view)
 * @property {boolean} legend name the colours under the chart (clock view)
 * @property {string} caption "" for none
 * @property {string} subtitle "" for none
 * @property {string} footnote "" for none
 * @property {string} credit "" for none
 */

const FONT = '"Space Grotesk", sans-serif';
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The first day of each month, counted from 0, and the year's length.
 *
 * @param {number} days 365 or 366
 */
export function monthStarts(days) {
  const lengths = [31, days === 366 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [0];
  for (const n of lengths) out.push(out[out.length - 1] + n);
  return out;
}

/**
 * The parts of a stretch of the day between 0:00 and 24:00: a sunset after
 * midnight (Reykjavík in June) is drawn as two pieces, one at each end.
 *
 * @param {number} from local hours, may be below 0
 * @param {number} to local hours, may be above 24
 * @returns {Array<[number, number]>}
 */
export function clockPieces(from, to) {
  if (to - from >= 24) return [[0, 24]];
  if (to > 24)
    return [
      [from, 24],
      [0, to - 24],
    ].filter(([a, b]) => b > a);
  if (from < 0)
    return [
      [0, to],
      [from + 24, 24],
    ].filter(([a, b]) => b > a);
  return to > from ? [[from, to]] : [];
}

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
 * @param {Day[]} days
 */
export function drawSheet(canvas, o, days) {
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

  // Top: caption and subtitle.
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
  const chartTop = y + 36 * u;

  // Bottom, from the edge up: credit, footnote, legend, month names.
  let bottom = H - H * 0.05;
  const smallPx = Math.round(17 * u);
  if (o.credit) {
    ctx.font = `400 ${smallPx}px ${FONT}`;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "right";
    ctx.fillText(o.credit, W - padX, bottom);
    ctx.globalAlpha = 1;
    bottom -= smallPx + 16 * u;
  }
  if (o.footnote) {
    const px = fitPx(ctx, o.footnote, Math.round(20 * u), Math.round(12 * u), 400, maxText);
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = o.ink;
    ctx.textAlign = "center";
    ctx.fillText(o.footnote, W / 2, bottom);
    ctx.globalAlpha = 1;
    bottom -= px + 26 * u;
  }
  const tickPx = Math.round(20 * u);
  const legendPx = Math.round(21 * u);
  const legend = o.view === "clock" && o.legend;
  if (legend) bottom -= legendPx + 18 * u;
  const chartBottom = bottom - tickPx - 14 * u;

  ctx.font = `400 ${tickPx}px ${FONT}`;
  const labelW = ctx.measureText(o.view === "clock" ? "24:00" : "24 h").width + 14 * u;
  const left = padX + labelW;
  const right = W - padX;
  if (chartBottom - chartTop < 40 * u || right - left < 80 * u || !days.length) return;

  const n = days.length;
  const starts = monthStarts(n);
  const X = (/** @type {number} */ d) => left + (d / n) * (right - left);
  const Y = (/** @type {number} */ h) => chartBottom - (h / 24) * (chartBottom - chartTop);

  if (o.view === "clock") drawClock(ctx, o, days, X, Y, chartTop, chartBottom);
  else drawHours(ctx, o, days, X, Y, chartBottom);

  // Hour figures on the left, month names below.
  ctx.font = `400 ${tickPx}px ${FONT}`;
  ctx.fillStyle = o.ink;
  ctx.globalAlpha = 0.62;
  ctx.textAlign = "right";
  for (const h of [0, 6, 12, 18, 24])
    ctx.fillText(o.view === "clock" ? `${h}:00` : `${h} h`, left - 12 * u, Y(h) + tickPx * 0.35);
  ctx.textAlign = "center";
  MONTHS.forEach((m, i) =>
    ctx.fillText(m, X((starts[i] + starts[i + 1]) / 2), chartBottom + tickPx + 8 * u),
  );
  ctx.globalAlpha = 1;

  if (legend) {
    const items = /** @type {Array<[string, string]>} */ ([
      ["Day", o.day],
      ...(o.showTwilight ? [["Twilight", o.twilight]] : []),
      ["Night", o.night],
    ]);
    let x = left;
    const yy = chartBottom + tickPx + 22 * u + legendPx;
    ctx.font = `400 ${legendPx}px ${FONT}`;
    ctx.textAlign = "left";
    for (const [text, colour] of items) {
      ctx.fillStyle = colour;
      ctx.fillRect(x, yy - legendPx * 0.85, legendPx, legendPx);
      ctx.fillStyle = o.ink;
      ctx.fillText(text, x + legendPx * 1.45, yy);
      x += legendPx * 1.45 + ctx.measureText(text).width + 34 * u;
    }
  }
}

/**
 * Day, twilight and night, one column per day, and the sunrise and sunset
 * lines.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {SheetOptions} o
 * @param {Day[]} days
 * @param {(d: number) => number} X
 * @param {(h: number) => number} Y
 * @param {number} top
 * @param {number} bottom
 */
function drawClock(ctx, o, days, X, Y, top, bottom) {
  for (const d of days) {
    // Whole pixels, edge to edge, so no seams show between the days.
    const x = Math.floor(X(d.day));
    const w = Math.floor(X(d.day + 1)) - x;
    ctx.fillStyle = o.night;
    ctx.fillRect(x, top, w, bottom - top);
    /**
     * @param {Day["sun"]} span
     * @param {string} colour
     */
    const band = (span, colour) => {
      if (span === "night") return;
      const pieces = span === "day" ? [[0, 24]] : clockPieces(span[0], span[1]);
      ctx.fillStyle = colour;
      for (const [a, b] of pieces) {
        const y0 = Math.round(Y(b));
        ctx.fillRect(x, y0, w, Math.round(Y(a)) - y0);
      }
    };
    if (o.showTwilight) band(d.twilight, o.twilight);
    band(d.sun, o.day);
  }
  // Faint hour lines over the bands: every 6 hours.
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (const h of [6, 12, 18]) {
    ctx.beginPath();
    ctx.moveTo(X(0), Math.round(Y(h)) + 0.5);
    ctx.lineTo(X(days.length), Math.round(Y(h)) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!o.showLines) return;
  // Sunrise and sunset, each broken where it crosses midnight.
  ctx.strokeStyle = o.line;
  ctx.lineWidth = Math.max(1.5, (2.6 * (bottom - top)) / 640);
  ctx.lineJoin = "round";
  for (const k of [0, 1]) {
    ctx.beginPath();
    /** @type {number | null} */
    let prev = null;
    for (const d of days) {
      if (typeof d.sun === "string") {
        prev = null;
        continue;
      }
      const t = ((d.sun[k] % 24) + 24) % 24;
      const px = X(d.day + 0.5);
      if (prev === null || Math.abs(t - prev) > 12) ctx.moveTo(px, Y(t));
      else ctx.lineTo(px, Y(t));
      prev = t;
    }
    ctx.stroke();
  }
}

/**
 * The hours of daylight as one filled curve, with a line at 12 hours.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {SheetOptions} o
 * @param {Day[]} days
 * @param {(d: number) => number} X
 * @param {(h: number) => number} Y
 * @param {number} bottom
 */
function drawHours(ctx, o, days, X, Y, bottom) {
  ctx.strokeStyle = o.ink;
  ctx.lineWidth = 1;
  for (const h of [0, 6, 12, 18, 24]) {
    ctx.globalAlpha = h === 12 ? 0.35 : 0.12;
    ctx.beginPath();
    ctx.moveTo(X(0), Math.round(Y(h)) + 0.5);
    ctx.lineTo(X(days.length), Math.round(Y(h)) + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const curve = new Path2D();
  days.forEach((d, i) => {
    if (i) curve.lineTo(X(d.day + 0.5), Y(d.hours));
    else curve.moveTo(X(d.day + 0.5), Y(d.hours));
  });
  const area = new Path2D(curve);
  area.lineTo(X(days.length - 0.5), bottom);
  area.lineTo(X(0.5), bottom);
  area.closePath();
  ctx.fillStyle = o.day;
  ctx.fill(area);
  ctx.strokeStyle = o.line;
  ctx.lineWidth = Math.max(1.5, (3 * (bottom - Y(24))) / 640);
  ctx.stroke(curve);
}
