/**
 * Export treemaps — drawing the chart as SVG: headline, treemap, labels and
 * legend.
 */

import { OTHER, SECTIONS } from "./config.js";
import { squarify } from "./treemap.js";

/** @typedef {import("./oec.js").Product} Product */

/**
 * @typedef {object} Box a drawn product block, for labelling
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {string} color
 * @property {string} name
 * @property {number} share of everything shown
 */

export const SVGNS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG element.
 *
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @returns {SVGElement}
 */
export function el(tag, attrs) {
  const e = /** @type {SVGElement} */ (document.createElementNS(SVGNS, tag));
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/**
 * $1.23T, $45.6B, $789M…
 *
 * @param {number} v
 * @returns {string}
 */
export function money(v) {
  const u = /** @type {Array<[number, string]>} */ ([
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ]);
  for (const [n, s] of u) if (v >= n) return "$" + (v / n).toFixed(v / n < 10 ? 2 : 1) + s;
  return "$" + Math.round(v);
}

/* ═══════════════════════════════════════════════════════════
   Measuring text

   Text can only be measured once the SVG is on the page, so labels are added
   after the chart is inserted. Anything that won't fit stays bare.
   ═══════════════════════════════════════════════════════════ */

const FONT = '"Inter","Helvetica Neue",Helvetica,Arial,sans-serif';
/** Measure once at this size, then scale linearly. */
const REF = 100;
/** @type {Map<string, number>} */
const widthCache = new Map();

/** Forget measured widths, e.g. before drawing a new chart. */
export const resetMeasurements = () => widthCache.clear();

/**
 * @param {SVGElement} svg
 * @param {string} str
 * @param {number} weight
 * @returns {number} width at {@link REF} px
 */
function measure(svg, str, weight) {
  const key = weight + "|" + str;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  let w;
  try {
    const t = /** @type {SVGTextElement} */ (
      el("text", {
        x: -9999,
        y: -9999,
        "font-family": FONT,
        "font-size": REF,
        "font-weight": weight,
        visibility: "hidden",
      })
    );
    t.textContent = str;
    svg.appendChild(t);
    w = t.getComputedTextLength();
    svg.removeChild(t);
  } catch {
    w = 0;
  }
  if (!w) w = str.length * REF * 0.55; // rough fallback
  widthCache.set(key, w);
  return w;
}

/**
 * @param {SVGElement} svg
 * @param {string} s
 * @param {number} fs font size
 * @param {number} [weight=600]
 */
const widthAt = (svg, s, fs, weight) => (measure(svg, s, weight || 600) * fs) / REF;

/**
 * Greedy wrap.
 *
 * @param {SVGElement} svg
 * @param {string} str
 * @param {number} maxW
 * @param {number} fs
 * @param {number} maxLines
 * @returns {string[] | null} `null` if a single word can't fit, or it needs too many lines
 */
function wrapText(svg, str, maxW, fs, maxLines) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (widthAt(svg, word, fs) > maxW) return null;
    const test = line ? line + " " + word : word;
    if (widthAt(svg, test, fs) <= maxW) line = test;
    else {
      lines.push(line);
      line = word;
      if (lines.length > maxLines) return null;
    }
  }
  if (line) lines.push(line);
  return lines.length && lines.length <= maxLines ? lines : null;
}

/**
 * White text on dark blocks, near-black on light ones.
 *
 * @param {string} hex
 */
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#1f2428" : "#ffffff";
}

/**
 * @param {string} str
 * @param {number} x
 * @param {number} y
 * @param {number} fs
 * @param {string} fill
 * @param {number} weight
 * @param {number} [opacity]
 */
function textEl(str, x, y, fs, fill, weight, opacity) {
  const t = el("text", {
    x: x.toFixed(2),
    y: y.toFixed(2),
    fill,
    "font-family": FONT,
    "font-size": fs,
    "font-weight": weight,
    "paint-order": "stroke",
  });
  if (opacity) t.setAttribute("opacity", String(opacity));
  t.textContent = str;
  return t;
}

/** @param {number} s share, 0–1 */
function shareText(s) {
  const pct = s * 100;
  return (pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)) + "%";
}

/* ═══════════════════════════════════════════════════════════
   The chart
   ═══════════════════════════════════════════════════════════ */

/**
 * Sections present, biggest first — shared by the treemap and the legend.
 *
 * @param {Product[]} products
 */
function groupsOf(products) {
  /** @type {Map<number, {section: number, value: number, items: Product[]}>} */
  const bySec = new Map();
  for (const p of products) {
    let g = bySec.get(p.section);
    if (!g) {
      g = { section: p.section, value: 0, items: [] };
      bySec.set(p.section, g);
    }
    g.value += p.value;
    g.items.push(p);
  }
  return [...bySec.values()].sort((a, b) => b.value - a.value);
}

/**
 * Total across everything the country exports, printed above the chart.
 *
 * @param {SVGElement} svg
 * @param {number} total
 * @param {number} s scale relative to a 1200 px chart
 * @param {number} pad
 * @returns {number} height used
 */
function drawHeadline(svg, total, s, pad) {
  const fs = Math.round(34 * s);
  const subFs = Math.round(15 * s);
  const amount = money(total);
  const base = pad + fs * 0.84;
  svg.appendChild(textEl(amount, pad, base, fs, "#16202a", 700));
  svg.appendChild(
    textEl(
      "total exports",
      pad + widthAt(svg, amount, fs, 700) + 10 * s,
      base,
      subFs,
      "#5d6b78",
      400,
    ),
  );
  return Math.round(base + fs * 0.32);
}

/**
 * Product-group key across the foot of the chart. Wraps to as many rows as
 * it needs.
 *
 * @param {SVGElement} svg
 * @param {Array<{section: number}>} groups
 * @param {number} W
 * @param {number} H
 * @param {number} s
 * @param {number} pad
 * @returns {number} height used
 */
function drawLegend(svg, groups, W, H, s, pad) {
  const fs = Math.round(14 * s);
  const chip = Math.round(12 * s);
  const inner = Math.round(8 * s);
  const between = Math.round(22 * s);
  const rowH = Math.round(21 * s);
  const items = groups.map((g) => {
    const [name, color] = SECTIONS[g.section] || OTHER;
    return { name, color, w: chip + inner + widthAt(svg, name, fs, 400) };
  });

  const maxW = W - 2 * pad;
  /** @type {Array<typeof items>} */
  const rows = [[]];
  let used = 0;
  for (const it of items) {
    const row = rows[rows.length - 1];
    const need = it.w + (row.length ? between : 0);
    if (row.length && used + need > maxW) {
      rows.push([it]);
      used = it.w;
    } else {
      row.push(it);
      used += need;
    }
  }

  const topGap = Math.round(pad * 0.7);
  const height = rows.length * rowH + Math.round(pad * 0.8) + topGap;
  let y = H - height + topGap;
  for (const row of rows) {
    const top = y + (rowH - chip) / 2;
    let x = pad;
    for (const it of row) {
      svg.appendChild(
        el("rect", {
          x: x.toFixed(2),
          y: top.toFixed(2),
          width: chip,
          height: chip,
          rx: Math.round(2 * s),
          fill: it.color,
        }),
      );
      svg.appendChild(textEl(it.name, x + chip + inner, top + chip * 0.92, fs, "#46525d", 400));
      x += it.w + between;
    }
    y += rowH;
  }
  return height;
}

/**
 * Draw headline, treemap and legend into `svg`.
 *
 * @param {SVGElement} svg already on the page, so text can be measured
 * @param {Product[]} products those above the cutoff
 * @param {number} grandTotal everything the country exports
 * @param {number} W
 * @param {number} H
 * @returns {Box[]} the product blocks, for {@link addLabels}
 */
export function drawChart(svg, products, grandTotal, W, H) {
  const s = W / 1200;
  const pad = Math.round(16 * s);
  svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));

  const groups = groupsOf(products);
  const headerH = drawHeadline(svg, grandTotal, s, pad);
  const footerH = drawLegend(svg, groups, W, H, s, pad);

  const areaY = headerH;
  const areaH = H - headerH - footerH;
  /** @type {Box[]} */
  const boxes = [];
  if (areaH < 40) return boxes;

  const shown = products.reduce((a, p) => a + p.value, 0);
  // Sections first, then the products inside each section's block.
  for (const g of squarify(groups, pad, areaY, W - 2 * pad, areaH)) {
    const gap = 2;
    const bx = g.x + gap;
    const by = g.y + gap;
    const bw = Math.max(0, g.w - 2 * gap);
    const bh = Math.max(0, g.h - 2 * gap);
    const [, color] = SECTIONS[g.n.node.section] || OTHER;
    for (const t of squarify(g.n.node.items, bx, by, bw, bh)) {
      const w = Math.max(0, t.w);
      const h = Math.max(0, t.h);
      svg.appendChild(
        el("rect", {
          x: t.x.toFixed(2),
          y: t.y.toFixed(2),
          width: w.toFixed(2),
          height: h.toFixed(2),
          fill: color,
          stroke: "#ffffff",
          "stroke-width": 1.2,
        }),
      );
      boxes.push({
        x: t.x,
        y: t.y,
        w,
        h,
        color,
        name: t.n.node.name,
        share: t.n.node.value / shown,
      });
    }
  }
  return boxes;
}

/**
 * Label every block that has room: the product name, and in "full" mode its
 * share too, each clipped to its block.
 *
 * @param {SVGElement} svg
 * @param {Box[]} boxes
 * @param {"none" | "name" | "full" | string} mode
 * @returns {number} how many blocks got a label
 */
export function addLabels(svg, boxes, mode) {
  if (mode === "none") return 0;
  const PAD = 5;
  let placed = 0;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = el("defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  const defsEl = defs;

  boxes.forEach((b, i) => {
    const availW = (b.w - 2 * PAD) * 0.97; // margin, in case font metrics shift
    const availH = b.h - 2 * PAD;
    if (availW < 22 || availH < 10) return;

    const ink = inkFor(b.color);
    const start = Math.min(21, Math.max(8, Math.round(Math.sqrt(b.w * b.h) / 6)));

    for (let fs = start; fs >= 8; fs--) {
      const lines = wrapText(
        svg,
        b.name,
        availW,
        fs,
        Math.min(3, Math.floor(availH / (fs * 1.15))),
      );
      if (!lines) continue;

      const subFs = Math.max(7, Math.round(fs * 0.78));
      const wantSub = mode === "full" && widthAt(svg, shareText(b.share), subFs) <= availW;
      const needed = lines.length * fs * 1.16 + (wantSub ? subFs * 1.3 : 0);
      if (needed > availH) continue;

      // Clip to the block so a label can never bleed into its neighbour.
      const clipId = "lc" + i;
      const clip = el("clipPath", { id: clipId });
      clip.appendChild(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h }));
      defsEl.appendChild(clip);
      const g = el("g", { "clip-path": `url(#${clipId})` });

      let y = b.y + PAD + fs * 0.9;
      for (const ln of lines) {
        g.appendChild(textEl(ln, b.x + PAD, y, fs, ink, 600));
        y += fs * 1.16;
      }
      if (wantSub)
        g.appendChild(
          textEl(shareText(b.share), b.x + PAD, y + subFs * 0.15, subFs, ink, 400, 0.78),
        );
      svg.appendChild(g);
      placed++;
      break;
    }
  });
  return placed;
}
