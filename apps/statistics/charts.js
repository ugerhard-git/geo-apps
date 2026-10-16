/**
 * Country statistics — drawing one chart (a pie or a bar chart, with its
 * title, legend and source line) into a box on the sheet.
 */

import { clamp } from "../../shared/util.js";

/** @typedef {import("./series.js").Series} Series */

/**
 * @typedef {object} ChartOptions
 * @property {string} fg text colour
 * @property {boolean} values print each share
 * @property {boolean} source print the source line
 * @property {string[]} colours the palette
 */

/**
 * Shrink the type until `text` fits `max`, and leave that font set.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} max
 * @param {number} px starting size
 * @param {number} [weight=400]
 * @returns {number} the size that fits
 */
export function fitText(ctx, text, max, px, weight) {
  let size = px;
  ctx.font = `${weight || 400} ${size}px "Inter", sans-serif`;
  while (size > 8 && ctx.measureText(text).width > max) {
    size -= 1;
    ctx.font = `${weight || 400} ${size}px "Inter", sans-serif`;
  }
  return size;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} title
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} px
 * @param {ChartOptions} opts
 * @returns {number} height used
 */
function drawChartTitle(ctx, title, x, y, w, px, opts) {
  ctx.fillStyle = opts.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = fitText(ctx, title, w, px, 600);
  ctx.fillText(title, x, y + size);
  return size * 1.5;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y baseline
 * @param {number} w
 * @param {number} px
 * @param {ChartOptions} opts
 * @returns {number} height used
 */
function drawSourceLine(ctx, text, x, y, w, px, opts) {
  if (!text) return 0;
  ctx.fillStyle = opts.fg;
  ctx.globalAlpha = 0.5;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = fitText(ctx, text, w, px, 400);
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
  return size;
}

/**
 * A value as a percentage. A value that is already a share of the population
 * stands as it is.
 *
 * @param {number} value
 * @param {number} total
 * @param {boolean} [absolute]
 * @returns {string}
 */
export function formatShare(value, total, absolute) {
  const pct = absolute ? value : total > 0 ? (value / total) * 100 : 0;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/** A hidden name or share is drawn as this, so players see something is hidden. */
const HIDDEN = "?";

/**
 * The name of a slice as drawn.
 *
 * @param {import("./series.js").Slice} s
 */
const nameOf = (s) => (s.hideName ? HIDDEN : s.label);

/**
 * What one legend row needs at a given type size.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} total
 * @param {number} px
 * @param {ChartOptions} opts
 */
function legendMetrics(ctx, series, total, px, opts) {
  const chip = px * 0.85;
  let maxLabel = 0;
  let maxPct = 0;
  ctx.font = `400 ${px}px "Inter", sans-serif`;
  for (const s of series.slices) maxLabel = Math.max(maxLabel, ctx.measureText(nameOf(s)).width);
  if (opts.values) {
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    for (const s of series.slices)
      maxPct = Math.max(
        maxPct,
        ctx.measureText(formatShare(s.value, total, series.absolute)).width,
      );
  }
  const rowW = chip + px * 0.5 + maxLabel + (maxPct ? px * 0.6 + maxPct : 0);
  return { rowW, rowH: px * 1.75, chip, maxLabel, maxPct };
}

/**
 * @typedef {object} PiePlan
 * @property {"side" | "below"} mode where the legend goes
 * @property {number} px legend type size
 * @property {ReturnType<typeof legendMetrics>} m
 * @property {number} pie diameter
 * @property {number} cols legend columns
 * @property {number} rows legend rows
 */

/**
 * Fit the legend to its text rather than to a fixed fraction of the box, and
 * drop it underneath the pie when the box is too narrow to carry it alongside.
 * Shrinking the type or moving the legend both beat truncating a label to "…".
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} total
 * @param {number} w
 * @param {number} h
 * @param {ChartOptions} opts
 * @returns {PiePlan | null}
 */
function pieLayout(ctx, series, total, w, h, opts) {
  const n = series.slices.length;
  const maxPx = clamp(Math.round(h * 0.1), 10, 32);
  const readable = clamp(Math.round(h * 0.048), 10, 18);
  /** @type {PiePlan[]} */
  const options = [];
  for (let px = maxPx; px >= 9; px--) {
    const m = legendMetrics(ctx, series, total, px, opts);
    const sidePie = Math.min(w - m.rowW - w * 0.04, h);
    if (m.rowH * n <= h && sidePie > 0)
      options.push({ mode: "side", px, m, pie: sidePie, cols: 1, rows: n });
    const cols = clamp(Math.floor(w / (m.rowW + w * 0.03)), 1, n);
    const rows = Math.ceil(n / cols);
    const belowPie = Math.min(w, h - m.rowH * rows - h * 0.04);
    if (m.rowW <= w && belowPie > 0)
      options.push({ mode: "below", px, m, pie: belowPie, cols, rows });
  }
  if (!options.length) return null;
  // Prefer layouts whose type is still readable, then the largest pie.
  const comfortable = options.filter((o) => o.px >= readable);
  const pool = comfortable.length ? comfortable : options;
  pool.sort((a, b) => b.pie - a.pie || b.px - a.px);
  return pool[0];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} total
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {string[]} cols
 */
function drawPieWedges(ctx, series, total, cx, cy, r, cols) {
  let angle = -Math.PI / 2;
  series.slices.forEach((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = cols[i % cols.length];
    ctx.fill();
    angle += sweep;
  });
}

/**
 * Legend rows down one column, or wrapped into several when it sits below.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} total
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {ChartOptions} opts
 * @param {PiePlan} plan
 */
function drawLegend(ctx, series, total, x, y, w, h, opts, plan) {
  const cols = opts.colours;
  const px = plan.px;
  const m = plan.m;
  const nCols = plan.mode === "below" ? plan.cols : 1;
  const perCol = Math.ceil(series.slices.length / nCols);
  const colW = nCols > 1 ? w / nCols : w;
  const blockH = m.rowH * perCol;
  const top = y + Math.max(0, (h - blockH) / 2);
  series.slices.forEach((s, i) => {
    const c = Math.floor(i / perCol);
    const rowIdx = i % perCol;
    const cx = x + c * colW;
    const ly = top + rowIdx * m.rowH + m.rowH / 2;
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(cx, ly - m.chip / 2, m.chip, m.chip);
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.fg;
    let pctW = 0;
    if (opts.values) {
      const pct = formatShare(s.value, total, series.absolute);
      ctx.font = `500 ${px}px "Inter", sans-serif`;
      pctW = m.maxPct + px * 0.6;
      ctx.textAlign = "right";
      ctx.fillText(pct, cx + Math.min(colW, m.rowW), ly);
    }
    ctx.textAlign = "left";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    const room = Math.min(colW, m.rowW) - m.chip - px * 0.5 - pctW;
    const full = nameOf(s);
    let label = full;
    // Only ever a last resort: the layout is chosen so this rarely fires.
    // Half a pixel of slack: the legend is sized to its widest label, and
    // rounding alone shouldn't cut that label short.
    while (label.length > 4 && ctx.measureText(label).width > room + 0.5)
      label = label.slice(0, -2);
    if (label !== full) label = label.replace(/\s+\S*$/, "") + "…";
    ctx.globalAlpha = 0.9;
    ctx.fillText(label, cx + m.chip + px * 0.5, ly);
    ctx.globalAlpha = 1;
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {ChartOptions} opts
 */
function drawPie(ctx, series, x, y, w, h, opts) {
  const total = series.slices.reduce((s, v) => s + v.value, 0);
  if (total <= 0) return;
  const plan = pieLayout(ctx, series, total, w, h, opts);
  if (!plan) return;
  const r = plan.pie / 2;
  if (plan.mode === "side") {
    drawPieWedges(ctx, series, total, x + r, y + h / 2, r, opts.colours);
    drawLegend(
      ctx,
      series,
      total,
      x + plan.pie + w * 0.04,
      y,
      w - plan.pie - w * 0.04,
      h,
      opts,
      plan,
    );
  } else {
    drawPieWedges(ctx, series, total, x + w / 2, y + r, r, opts.colours);
    const ly = y + plan.pie + h * 0.04;
    drawLegend(ctx, series, total, x, ly, w, h - plan.pie - h * 0.04, opts, plan);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Series} series
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {ChartOptions} opts
 */
function drawBars(ctx, series, x, y, w, h, opts) {
  const cols = opts.colours;
  const total = series.slices.reduce((s, v) => s + v.value, 0);
  const max = series.slices.reduce((m, v) => Math.max(m, v.value), 0);
  if (max <= 0) return;
  const n = series.slices.length;
  const lineH = h / n;
  const px = clamp(Math.round(lineH * 0.3), 9, 34);
  ctx.font = `400 ${px}px "Inter", sans-serif`;
  let labelW = 0;
  for (const s of series.slices) labelW = Math.max(labelW, ctx.measureText(nameOf(s)).width);
  labelW = Math.min(labelW + px * 0.6, w * 0.4);
  const pctW = opts.values ? px * 2.8 : 0;
  const barMax = w - labelW - pctW;
  series.slices.forEach((s, i) => {
    const ly = y + i * lineH + lineH / 2;
    const bw = Math.max(1, (s.value / max) * barMax);
    const bh = Math.min(lineH * 0.55, px * 1.7);
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.9;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillText(nameOf(s), x + labelW - px * 0.5, ly);
    ctx.globalAlpha = 1;
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(x + labelW, ly - bh / 2, bw, bh);
    if (opts.values) {
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left";
      ctx.font = `500 ${px}px "Inter", sans-serif`;
      ctx.fillText(formatShare(s.value, total, series.absolute), x + labelW + bw + px * 0.4, ly);
    }
  });
}

/**
 * Draw one statistic into the box `(x, y, w, h)`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./config.js").Stat} stat
 * @param {Series} series
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {ChartOptions} opts
 */
export function drawChart(ctx, stat, series, x, y, w, h, opts) {
  const titlePx = clamp(Math.round(h * 0.11), 12, 40);
  const used = drawChartTitle(ctx, stat.title, x, y, w, titlePx, opts);
  let bodyH = h - used;
  const bodyY = y + used;
  if (opts.source && series.note) {
    const srcPx = Math.max(9, Math.round(titlePx * 0.52));
    bodyH -= srcPx * 2.1;
    drawSourceLine(ctx, series.note, x, y + h, w, srcPx, opts);
  }
  if (bodyH < 20) return;
  if (stat.chart === "bar") drawBars(ctx, series, x, bodyY, w, bodyH, opts);
  else drawPie(ctx, series, x, bodyY, w, bodyH, opts);
}
