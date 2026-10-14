/**
 * OWID chart plotter — the 2400 × 1600 PNG export: title, chart, an optional
 * legend and the source line on one canvas. Country names appear only in the
 * legend, and only when it is switched on (with whatever labels were typed),
 * so by default the export works as a quiz clue.
 */

import { buildConfig } from "./charts.js";

/** @typedef {import("./data.js").Dataset} Dataset */
/** @typedef {import("./charts.js").View} View */

export const EXPORT_W = 2400;
export const EXPORT_H = 1600;

/**
 * Colours for each background mode; `bg: null` leaves the frame transparent.
 *
 * @param {string} mode "white" | "paper" | "ink" | "transparent"
 */
function themeFor(mode) {
  if (mode === "ink") return { bg: "#12233A", ink: "#F4F7FA", soft: "#93A7BA", rule: "#3A5170" };
  return {
    bg: mode === "white" ? "#FFFFFF" : mode === "paper" ? "#F4F7FA" : null,
    ink: "#12233A",
    soft: "#4C6076",
    rule: "#C3CFDA",
  };
}

const TITLE_FONT = "'Bricolage Grotesque', 'Public Sans', sans-serif";
const TITLE_PX = 76;
const TITLE_LH = 86;

/**
 * Wrap the title to at most two lines of `maxW`.
 *
 * @param {CanvasRenderingContext2D} c with the title font set
 * @param {string} title
 * @param {number} maxW
 */
function titleLines(c, title, maxW) {
  const words = title.trim().split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (c.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && cur) lines.push(cur);
  return lines;
}

const LEGEND_PX = 28;
const LEGEND_SWATCH = 24;
const LEGEND_ROW = 48;

/**
 * @typedef {object} LegendItem
 * @property {string} label
 * @property {string} colour
 */

/**
 * Lay legend items out in centred rows no wider than `maxW`.
 *
 * @param {CanvasRenderingContext2D} c with the legend font set
 * @param {LegendItem[]} items
 * @param {number} maxW
 * @returns {Array<{items: Array<LegendItem & {w: number}>, w: number}>}
 */
function legendRows(c, items, maxW) {
  const inner = 12; // swatch to text
  const between = 40; // one item to the next
  /** @type {Array<{items: Array<LegendItem & {w: number}>, w: number}>} */
  const rows = [];
  for (const it of items) {
    const w = LEGEND_SWATCH + inner + c.measureText(it.label).width;
    const row = rows[rows.length - 1];
    if (row && row.w + between + w <= maxW) {
      row.items.push({ ...it, w });
      row.w += between + w;
    } else rows.push({ items: [{ ...it, w }], w });
  }
  return rows;
}

/**
 * Render the export.
 *
 * @param {object} opts
 * @param {Dataset} opts.data
 * @param {View} opts.view
 * @param {string} opts.title
 * @param {string} opts.stamp source line for the footer
 * @param {LegendItem[] | null} [opts.legend] a legend under the chart, or none
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderExport({ data, view, title, stamp, legend = null }) {
  const mode = view.bg;
  const theme = themeFor(mode);
  const pad = 96;
  const footH = 120;
  const plotW = EXPORT_W - pad * 2;

  // The final frame — created up front so its context can measure the title.
  const out = document.createElement("canvas");
  out.width = EXPORT_W;
  out.height = EXPORT_H;
  const c = /** @type {CanvasRenderingContext2D} */ (out.getContext("2d"));

  // The header height follows from how many lines the title takes.
  c.font = "600 " + TITLE_PX + "px " + TITLE_FONT;
  const lines = titleLines(c, title, plotW);

  // The subtitle carries the unit only.
  const subText = data.unit ? "Measured in " + data.unit : "";
  const headH = pad + lines.length * TITLE_LH + (subText ? 44 : 0) + 40;
  c.font = "500 " + LEGEND_PX + "px 'Public Sans', sans-serif";
  const lrows = legend && legend.length ? legendRows(c, legend, plotW) : [];
  const legendH = lrows.length ? lrows.length * LEGEND_ROW + 24 : 0;
  const plotH = EXPORT_H - headH - footH - legendH;
  const k = plotH / 460; // scale factor vs. the on-screen reference height

  // Render the chart offscreen at full export size.
  const off = document.createElement("canvas");
  off.width = plotW;
  off.height = plotH;
  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-99999px;top:0;width:" + plotW + "px;height:" + plotH + "px";
  holder.appendChild(off);
  document.body.appendChild(holder);

  const cfg = buildConfig(data, view, k, true);
  cfg.options.responsive = false;
  if (mode === "ink") {
    cfg.options.color = theme.soft;
    for (const ax of Object.values(cfg.options.scales || {})) {
      ax.ticks = Object.assign({}, ax.ticks, { color: theme.soft });
      if (ax.title) ax.title.color = theme.soft;
      ax.grid = Object.assign({}, ax.grid, { color: "rgba(244,247,250,.14)" });
    }
    cfg.options.plugins = cfg.options.plugins || {};
    if (cfg.options.plugins.legend)
      cfg.options.plugins.legend.labels = Object.assign({}, cfg.options.plugins.legend.labels, {
        color: theme.ink,
      });
  }
  const tmp = new Chart(/** @type {CanvasRenderingContext2D} */ (off.getContext("2d")), cfg);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Compose the final frame.
  if (theme.bg) {
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, EXPORT_W, EXPORT_H);
  }

  c.textBaseline = "alphabetic";
  c.fillStyle = theme.ink;
  c.font = "600 " + TITLE_PX + "px " + TITLE_FONT;
  lines.forEach((ln, i) => c.fillText(ln, pad, pad + 62 + i * TITLE_LH));

  if (subText) {
    c.fillStyle = theme.soft;
    c.font = "400 26px 'Public Sans', sans-serif";
    c.fillText(subText, pad, pad + lines.length * TITLE_LH + 30);
  }

  c.drawImage(off, pad, headH);

  // The legend: centred rows of colour swatches and labels under the chart.
  if (lrows.length) {
    c.font = "500 " + LEGEND_PX + "px 'Public Sans', sans-serif";
    c.textBaseline = "middle";
    lrows.forEach((row, r) => {
      const y = headH + plotH + 24 + r * LEGEND_ROW + LEGEND_ROW / 2;
      let x = pad + (plotW - row.w) / 2;
      for (const it of row.items) {
        c.fillStyle = it.colour;
        c.fillRect(x, y - LEGEND_SWATCH / 2, LEGEND_SWATCH, LEGEND_SWATCH);
        c.fillStyle = theme.ink;
        c.fillText(it.label, x + LEGEND_SWATCH + 12, y + 1);
        x += it.w + 40;
      }
    });
    c.textBaseline = "alphabetic";
  }

  c.strokeStyle = theme.rule;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(pad, EXPORT_H - footH + 44);
  c.lineTo(EXPORT_W - pad, EXPORT_H - footH + 44);
  c.stroke();
  c.fillStyle = theme.soft;
  c.font = "400 24px 'IBM Plex Mono', monospace";
  c.fillText(stamp, pad, EXPORT_H - footH + 84);

  tmp.destroy();
  holder.remove();
  return out;
}
