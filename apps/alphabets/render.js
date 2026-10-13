/**
 * Alphabets — drawing one or more alphabets on the sheet.
 */

import { own } from "../../shared/util.js";
import { LEGIBLE_PX, MAX_CELLS, SCRIPT_FONT, SHEET_H, SHEET_W } from "./config.js";

/** @typedef {import("./cldr-data.js").Alphabet} Alphabet */

/**
 * @typedef {object} SheetOptions
 * @property {string} fg text colour
 * @property {string} bg background colour
 * @property {boolean} transparent
 * @property {boolean} aux include letters used only in loanwords
 * @property {boolean} sentence add a sample sentence
 * @property {boolean} pairs show capital and small letters together ("Aa")
 * @property {string} caption
 * @property {boolean} capTop
 * @property {boolean} names name each language (reveals the answer)
 * @property {string} generic heading for unnamed alphabets, "{n}" for its number
 */

/**
 * The font family for a script.
 *
 * @param {string} script
 * @returns {string}
 */
export const fontFor = (script) => own(SCRIPT_FONT, script) || "Noto Sans";

/**
 * The heading for an unnamed alphabet. "{n}" stands for its position; a
 * template without it gets the number appended, and an empty one means no
 * heading at all.
 *
 * @param {string} template
 * @param {number} index
 * @returns {string}
 */
export function genericHeading(template, index) {
  const t = String(template || "").trim();
  if (!t) return "";
  return t.includes("{n}") ? t.split("{n}").join(String(index + 1)) : `${t} ${index + 1}`;
}

/**
 * Unnamed by default, because naming the language gives the answer away when
 * the sheet is used as a puzzle. The script name is withheld too —
 * "Cyrillic" narrows it almost as much as the language would.
 *
 * @param {Alphabet} chart
 * @param {number} index
 * @param {boolean} showNames
 * @param {number} total how many alphabets are on the sheet
 * @param {string} generic
 * @returns {string}
 */
function headingFor(chart, index, showNames, total, generic) {
  const count = chart.truncated ? `${MAX_CELLS} of ${chart.total} characters` : "";
  /** @param {string} rest */
  const join = (rest) => (rest ? [rest, count].filter(Boolean).join(" · ") : count);
  if (showNames) return join(`${chart.name} · ${chart.script}`);
  // A lone unnamed alphabet needs no label; "Language 1" would only be noise.
  if (total === 1) return count;
  return join(genericHeading(generic, index));
}

/**
 * Choose the column count that makes the glyphs biggest, then draw.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} cells
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {Alphabet} chart
 * @returns {number} the glyph size, so the caller can warn when the sheet is overloaded
 */
function drawGrid(ctx, cells, x, y, w, h, chart) {
  if (!cells.length || h <= 0) return Infinity;
  const family = fontFor(chart.script);
  const K = cells.length;
  /** @param {number} px */
  const measureAt = (px) => {
    ctx.font = `400 ${px}px "${family}", sans-serif`;
    let widest = 0;
    for (const c of cells) widest = Math.max(widest, ctx.measureText(c).width);
    return widest;
  };
  let best = { size: 0, cols: 1, rows: 1, cellW: 0, cellH: 0 };
  for (let cols = 1; cols <= K; cols++) {
    const rows = Math.ceil(K / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    const probe = 100;
    const widest = measureAt(probe);
    const byWidth = widest > 0 ? (cellW * 0.82) / (widest / probe) : probe;
    const byHeight = cellH * 0.62;
    const size = Math.min(byWidth, byHeight);
    if (size > best.size) best = { size, cols, rows, cellW, cellH };
  }
  const { size, cols, cellW, cellH } = best;
  ctx.font = `400 ${size}px "${family}", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = chart.rtl ? "rtl" : "ltr";
  cells.forEach((cell, i) => {
    const r = Math.floor(i / cols);
    let c = i % cols;
    if (chart.rtl) c = cols - 1 - c; // right to left across the row
    const cx = x + c * cellW + cellW / 2;
    const cy = y + r * cellH + cellH / 2;
    ctx.fillText(cell, cx, cy);
  });
  ctx.direction = "ltr";
  return size;
}

/**
 * Draw the sheet onto `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Alphabet[]} charts
 * @param {SheetOptions} opts
 * @returns {{smallest: number, warning: string}} the smallest glyph size, and
 *   a warning when it is too small to read
 */
export function drawSheet(canvas, charts, opts) {
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  }
  ctx.fillStyle = opts.fg;
  const pad = 90;
  let top = pad;
  let bottom = SHEET_H - pad;

  // Caption first: it reserves space the charts can't use.
  if (opts.caption) {
    const capPx = 54;
    ctx.font = `400 ${capPx}px "Newsreader", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = opts.caption;
    let px = capPx;
    while (px > 26 && ctx.measureText(text).width > SHEET_W - pad * 2) {
      px -= 2;
      ctx.font = `400 ${px}px "Newsreader", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(text, SHEET_W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(text, SHEET_W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  /*
    With sentences on, one language's sentence ends up directly under the next
    one's heading, and the two read as a single block. Open a gutter between
    the bands so each language stays visually its own.
  */
  const gutter = charts.length < 2 ? 0 : opts.sentence ? Math.max(48, (bottom - top) * 0.05) : 16;
  const bandH = (bottom - top - gutter * (charts.length - 1)) / charts.length;
  let smallest = Infinity;

  charts.forEach((chart, idx) => {
    const bandTop = top + idx * (bandH + gutter);
    let y = bandTop;

    // Heading, where there is one. With none, the grid takes the space back.
    const heading = headingFor(chart, idx, opts.names, charts.length, opts.generic);
    if (heading) {
      const headPx = Math.min(44, Math.max(24, bandH * 0.11));
      ctx.font = `600 ${headPx}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.72;
      ctx.fillText(heading, pad, y + headPx);
      ctx.globalAlpha = 1;
      y += headPx * 1.75;
    }

    let gridBottom = bandTop + bandH - bandH * 0.06;
    let sentence = null;
    if (opts.sentence && chart.sentence) {
      sentence = chart.sentence;
      gridBottom -= Math.max(46, bandH * 0.24); // room for the label and the line
    }

    const items = opts.aux ? chart.letters.concat(chart.aux) : chart.letters;
    const cells = items.map((it) => (opts.pairs && it.upper ? it.upper + it.lower : it.lower));
    const size = drawGrid(ctx, cells, pad, y, SHEET_W - pad * 2, gridBottom - y, chart);
    smallest = Math.min(smallest, size);

    if (sentence) {
      const sPx = Math.max(22, Math.min(40, bandH * 0.1));
      const labelPx = Math.max(15, Math.round(sPx * 0.52));
      const anchor = chart.rtl ? SHEET_W - pad : pad;
      const baseline = bandTop + bandH - bandH * 0.045;
      // Say what this line is, so it isn't mistaken for more of the alphabet.
      ctx.font = `600 ${labelPx}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = chart.rtl ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      ctx.direction = "ltr";
      ctx.globalAlpha = 0.55;
      ctx.fillText("Example sentence", anchor, baseline - sPx * 1.15);
      ctx.font = `400 ${sPx}px "${fontFor(chart.script)}", sans-serif`;
      ctx.direction = chart.rtl ? "rtl" : "ltr";
      ctx.globalAlpha = 0.82;
      let t = sentence.text;
      while (t.length > 8 && ctx.measureText(t).width > SHEET_W - pad * 2) t = t.slice(0, -2);
      if (t !== sentence.text) t = t.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(t, anchor, baseline);
      ctx.globalAlpha = 1;
      ctx.direction = "ltr";
    }
  });

  const warning =
    smallest < LEGIBLE_PX
      ? `Letters are down to about ${Math.round(smallest)} px. Fewer languages, or turning off loanword letters, will give them room.`
      : "";
  return { smallest, warning };
}
