/**
 * OWID chart plotter — Chart.js configuration for each chart type.
 *
 * Chart.js is loaded as a classic script in index.html and used through the
 * global `Chart`.
 */

import { fmt, valueAt } from "./data.js";

/** @typedef {import("./data.js").Dataset} Dataset */

/**
 * @typedef {"line" | "area" | "bar" | "rank" | "donut" | "change"} ChartType
 *
 * @typedef {object} View what the form asks for
 * @property {ChartType} type
 * @property {string[]} picked entity names, in colour order
 * @property {number} y0 from year
 * @property {number} y1 to year
 * @property {boolean} marks dots on data points
 * @property {"linear" | "zero" | "log" | string} scale
 * @property {"legend" | "inline" | "off" | string} names how countries are named
 * @property {string} bg background mode of the export
 */

/** Series colours, in pick order. */
export const PALETTE = [
  "#E4572E",
  "#1F7A6C",
  "#E0A32E",
  "#4A5BA6",
  "#B23A6B",
  "#2F7FA8",
  "#6F8F32",
  "#8C5E58",
];

/** At most this many series. */
export const MAX_SERIES = PALETTE.length;

/** Kicker text above the chart, per type. */
export const TYPE_NAMES = {
  line: "Trend lines",
  area: "Stacked area",
  bar: "Grouped bars",
  rank: "Ranking",
  donut: "Share of total",
  change: "Change",
};

/** Chart types that show a single year (the "To" year). */
export const isSingleYear = (/** @type {ChartType} */ type) => type === "rank" || type === "donut";

/**
 * Chart.js plugin: draws each series name at its last data point, so the eye
 * never leaves the line. Options: `{enabled, scale, color}`.
 */
const endLabels = {
  id: "endLabels",
  /**
   * @param {any} c the chart
   * @param {unknown} _args
   * @param {{enabled?: boolean, scale?: number, color?: string}} opts
   */
  afterDatasetsDraw(c, _args, opts) {
    if (!opts || !opts.enabled) return;
    const k = opts.scale || 1;
    const ctx = c.ctx;
    ctx.save();
    ctx.font = `600 ${Math.round(13 * k)}px 'Public Sans', sans-serif`;
    ctx.textBaseline = "middle";
    /** @type {number[]} */
    const placed = [];
    c.data.datasets.forEach((/** @type {any} */ ds, /** @type {number} */ di) => {
      const meta = c.getDatasetMeta(di);
      if (meta.hidden) return;
      let last = null;
      for (let i = meta.data.length - 1; i >= 0; i--) {
        const v = ds.data[i];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          last = meta.data[i];
          break;
        }
      }
      if (!last) return;
      const gap = Math.round(8 * k);
      const lh = Math.round(17 * k);
      let y = last.y;
      while (placed.some((py) => Math.abs(py - y) < lh)) y += lh; // nudge apart on collision
      y = Math.min(Math.max(y, c.chartArea.top + lh / 2), c.chartArea.bottom - lh / 2);
      placed.push(y);
      const text = ds.label;
      const w = ctx.measureText(text).width;
      let x = last.x + gap;
      if (x + w > c.width - Math.round(2 * k)) x = last.x - gap - w; // flip inside the frame
      ctx.fillStyle = opts.color || ds.borderColor || "#12233A";
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  },
};
Chart.register(endLabels);

Chart.defaults.font.family = "Public Sans, system-ui, sans-serif";
Chart.defaults.color = "#4C6076";
Chart.defaults.borderColor = "rgba(18,35,58,.12)";

/**
 * Build the Chart.js config for `view`.
 *
 * @param {Dataset} data
 * @param {View} view
 * @param {number} k scale factor: 1 on screen, larger for the PNG export
 * @param {boolean} [hideNames] never draw a country name (exports are quiz clues)
 * @returns {any} a Chart.js config
 */
export function buildConfig(data, view, k, hideNames) {
  const { type, picked, y0, y1 } = view;
  const colour = (/** @type {number} */ i) => PALETTE[i % PALETTE.length];
  /** @param {number} n */
  const F = (n) => Math.round(n * k);
  const scaleY = () => {
    const ttl = { display: !!data.unit, text: data.unit, font: { size: F(12), weight: "600" } };
    if (view.scale === "log") return { type: "logarithmic", title: ttl };
    return { beginAtZero: view.scale === "zero", title: ttl };
  };
  const nameMode = hideNames ? "off" : view.names;
  const lineish = type === "line" || type === "area";
  const inline = nameMode === "inline" && lineish;
  const legend = {
    display: nameMode === "legend" && picked.length > 1,
    position: "bottom",
    labels: {
      boxWidth: F(10),
      boxHeight: F(10),
      usePointStyle: true,
      pointStyle: "rect",
      padding: F(14),
      font: { size: F(12) },
    },
  };
  const tip = {
    callbacks: {
      label: (/** @type {any} */ c) =>
        ` ${c.dataset.label || c.label}: ${fmt(c.parsed.y ?? c.parsed)}`,
    },
  };

  /** @type {any} */
  let cfg;

  if (type === "line" || type === "area") {
    const years = data.years.filter((y) => y >= y0 && y <= y1);
    cfg = {
      type: "line",
      data: {
        labels: years,
        datasets: picked.map((e, i) => {
          const m = /** @type {Map<number, number>} */ (data.byEntity.get(e));
          return {
            label: e,
            data: years.map((y) => (m.has(y) ? m.get(y) : null)),
            spanGaps: true,
            borderColor: colour(i),
            backgroundColor: type === "area" ? colour(i) + "cc" : "transparent",
            fill: type === "area",
            borderWidth: 2.2 * k,
            tension: 0.18,
            pointRadius: view.marks ? 2.6 * k : 0,
            pointHoverRadius: 5 * k,
            pointBackgroundColor: colour(i),
          };
        }),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { ...scaleY(), stacked: type === "area" },
        },
        plugins: { legend, tooltip: tip },
      },
    };
  }

  if (type === "bar") {
    // About eight evenly spaced years, always ending on the "To" year.
    const step = Math.max(1, Math.ceil((y1 - y0) / 7));
    const years = [];
    for (let y = y0; y <= y1; y += step) years.push(y);
    if (years[years.length - 1] !== y1) years.push(y1);
    cfg = {
      type: "bar",
      data: {
        labels: years.map(String),
        datasets: picked.map((e, i) => ({
          label: e,
          data: years.map((y) => valueAt(data, e, y)),
          backgroundColor: colour(i),
          borderWidth: 0,
          borderRadius: 1,
        })),
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { grid: { display: false } }, y: scaleY() },
        plugins: { legend, tooltip: tip },
      },
    };
  }

  if (type === "rank") {
    const rows = picked
      .map((e, i) => ({ e, v: valueAt(data, e, y1), c: colour(i) }))
      .filter((r) => r.v !== null)
      .sort((a, b) => /** @type {number} */ (b.v) - /** @type {number} */ (a.v));
    cfg = {
      type: "bar",
      data: {
        labels: rows.map((r) => r.e),
        datasets: [
          {
            label: String(y1),
            data: rows.map((r) => r.v),
            backgroundColor: rows.map((r) => r.c),
            borderWidth: 0,
            borderRadius: 1,
          },
        ],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        scales: {
          x: { ...scaleY(), beginAtZero: view.scale !== "log" },
          y: { grid: { display: false } },
        },
        plugins: { legend: { display: false }, tooltip: tip },
      },
    };
  }

  if (type === "donut") {
    const rows = picked
      .map((e, i) => ({ e, v: /** @type {number} */ (valueAt(data, e, y1)), c: colour(i) }))
      .filter((r) => r.v !== null && r.v > 0)
      .sort((a, b) => b.v - a.v);
    const total = rows.reduce((s, r) => s + r.v, 0);
    cfg = {
      type: "doughnut",
      data: {
        labels: rows.map((r) => r.e),
        datasets: [
          {
            data: rows.map((r) => r.v),
            backgroundColor: rows.map((r) => r.c),
            borderColor: k > 1 && view.bg === "transparent" ? "rgba(0,0,0,0)" : "#fff",
            borderWidth: 2 * k,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: "52%",
        plugins: {
          legend: { ...legend, display: nameMode !== "off" },
          tooltip: {
            callbacks: {
              label: (/** @type {any} */ c) =>
                ` ${c.label}: ${fmt(c.parsed)} (${((c.parsed / total) * 100).toFixed(1)}% of selection)`,
            },
          },
        },
      },
    };
  }

  if (type === "change") {
    const rows = picked
      .map((e, i) => {
        const a = valueAt(data, e, y0);
        const b = valueAt(data, e, y1);
        return { e, d: a === null || b === null ? null : b - a, c: colour(i) };
      })
      .filter((r) => r.d !== null)
      .sort((a, b) => /** @type {number} */ (b.d) - /** @type {number} */ (a.d));
    cfg = {
      type: "bar",
      data: {
        labels: rows.map((r) => r.e),
        datasets: [
          {
            label: `Change ${y0} → ${y1}`,
            data: rows.map((r) => r.d),
            backgroundColor: rows.map((r) => (/** @type {number} */ (r.d) < 0 ? "#B23A6B" : r.c)),
            borderWidth: 0,
            borderRadius: 1,
          },
        ],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: "rgba(18,35,58,.10)" },
            title: {
              display: true,
              text: "Difference" + (data.unit ? " (" + data.unit + ")" : ""),
            },
          },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (/** @type {any} */ c) =>
                ` ${c.label}: ${c.parsed.x > 0 ? "+" : ""}${fmt(c.parsed.x)}`,
            },
          },
        },
      },
    };
  }

  // Scale tick fonts, and skip animation for offscreen export renders.
  cfg.options = cfg.options || {};
  if (k !== 1) {
    cfg.options.devicePixelRatio = 1;
    cfg.options.animation = false;
  }
  cfg.options.scales = cfg.options.scales || {};
  for (const ax of Object.values(cfg.options.scales)) {
    ax.ticks = Object.assign({}, ax.ticks, { font: { size: F(11) } });
    if (ax.title) ax.title.font = { size: F(12), weight: "600" };
  }

  // Country names: inline end labels, or hide the category axis that carries them.
  cfg.options.plugins = cfg.options.plugins || {};
  cfg.options.plugins.endLabels = { enabled: inline, scale: k };
  if (inline) {
    // Leave room on the right for the labels.
    const longest = picked.reduce((m, e) => Math.max(m, e.length), 0);
    cfg.options.layout = { padding: { right: Math.round((longest * 7.6 + 18) * k) } };
  }
  if (nameMode === "off" && (type === "rank" || type === "change")) {
    cfg.options.scales.y = Object.assign({}, cfg.options.scales.y, { ticks: { display: false } });
  }
  return cfg;
}
