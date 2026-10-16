/**
 * Fact file — turning a country's record into blocks of text, numbers and
 * bars, and drawing them on the sheet in two balanced columns.
 *
 *   buildBlocks  the chosen fields as blocks, with names found (pure)
 *   drawSheet    sizes the blocks to fit, and draws everything
 *
 * A name that is blacked out is drawn as a bar of about its width, so the
 * card reads naturally; the bar is kept between 2.6 and 5.5 letters wide
 * so its length doesn't spell the name out.
 */

import { frameSpec } from "../../shared/sheet.js";
import { analyse } from "./blackout.js";
import { FIELDS } from "./config.js";

/** @typedef {import("./blackout.js").Part} Part */
/** @typedef {import("./blackout.js").Context} Context */
/** @typedef {import("./data.js").CountryRecord} CountryRecord */

/**
 * @typedef {object} Block
 * @property {string} id the field
 * @property {string} label
 * @property {string} [tag] a small remark after the label
 * @property {"text" | "stats" | "bars" | "badges"} kind
 * @property {Part[]} [parts] for "text"
 * @property {Array<{value: string, label: string}>} [stats]
 * @property {number[]} [bars] lengths in km, for "bars"
 * @property {string[]} [badges]
 */

/**
 * @typedef {object} SheetOptions
 * @property {string} paper
 * @property {string} ink
 * @property {string} accent the field labels
 * @property {string} bar the colour of the black-out bars
 * @property {boolean} transparent
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} note
 * @property {boolean} noteTop
 * @property {string} label the country's name, printed when not "" (reveals)
 * @property {string} credit the source line, "" for none
 */

/* ═══════════════════════════════════════════════════════════
   Blocks
   ═══════════════════════════════════════════════════════════ */

/** "1,014" */
const n0 = (/** @type {number} */ x) => Math.round(x).toLocaleString("en-GB");

/**
 * "1.8 million", "231,000", "277".
 *
 * @param {number} millions
 */
export function peopleText(millions) {
  if (millions >= 1) return `${(Math.round(millions * 10) / 10).toFixed(1)} million`;
  const n = millions * 1e6;
  return n >= 1000 ? n0(Math.round(n / 1000) * 1000) : n0(n);
}

/** @param {string} text @returns {Part[]} */
const plainParts = (text) => [{ text, term: null, auto: false, why: null }];

/**
 * The chosen fields of a record, as blocks.
 *
 * @param {CountryRecord} rec
 * @param {Set<string>} chosen field ids
 * @param {Context} ctx for finding names
 * @param {{from: boolean}} opts show whom independence came from
 * @returns {Block[]}
 */
export function buildBlocks(rec, chosen, ctx, opts) {
  const f = rec.fields;
  /** @type {Block[]} */
  const blocks = [];
  for (const field of FIELDS) {
    if (!chosen.has(field.id) || f[field.id] === undefined) continue;
    const v = f[field.id];
    const c = { ...ctx, broad: !!field.broad };
    /** @param {string} text @param {string} [tag] */
    const text = (text, tag) =>
      blocks.push({ id: field.id, label: field.label, kind: "text", parts: analyse(text, c), tag });
    switch (field.id) {
      case "heights": {
        const stats = [];
        if (v.high !== null) stats.push({ value: `${n0(v.high)} m`, label: "highest point" });
        if (v.low !== null) stats.push({ value: `${n0(v.low)} m`, label: "lowest point" });
        if (v.mean !== null) stats.push({ value: `${n0(v.mean)} m`, label: "average" });
        blocks.push({ id: field.id, label: field.label, kind: "stats", stats });
        break;
      }
      case "age": {
        const stats = [];
        if (v.median !== null) stats.push({ value: `${v.median} years`, label: "median age" });
        if (v.life !== null) stats.push({ value: `${v.life} years`, label: "life expectancy" });
        blocks.push({ id: field.id, label: field.label, kind: "stats", stats });
        break;
      }
      case "coast":
        text(v > 0 ? `${n0(v)} km` : "none — landlocked");
        break;
      case "borders":
        if (v.lengths.length)
          blocks.push({
            id: field.id,
            label: `${field.label} · ${v.lengths.length} ${v.lengths.length === 1 ? "neighbour" : "neighbours"}, ${n0(v.total)} km`,
            kind: "bars",
            bars: v.lengths,
          });
        else text("no land borders");
        break;
      case "area":
        text(`${n0(v)} sq km`);
        break;
      case "lake":
        text(`${n0(v.sqkm)} sq km${v.kind ? ", " + v.kind : ""}`);
        break;
      case "river":
        text(
          `${n0(v.km)} km` +
            (v.shared
              ? `, shared with ${v.shared} other ${v.shared === 1 ? "country" : "countries"}`
              : ""),
        );
        break;
      case "city":
        text(`${peopleText(v.millions)} people${v.capital ? " (the capital)" : ""}`);
        break;
      case "system":
        text(v.text, v.unsettled ? "may have changed" : undefined);
        break;
      case "parliament": {
        const seat = (/** @type {{seats: number, how: string, term: string}} */ s) =>
          `${n0(s.seats)} seats` +
          [s.how, s.term ? `${s.term.replace(/\s*years?$/, "")}-year terms` : ""]
            .filter(Boolean)
            .map((x, i) => (i === 0 ? " (" : ", ") + x)
            .join("") +
          (s.how || s.term ? ")" : "");
        const one = v.chambers === 1 || (v.chambers === 0 && v.seats.length === 1);
        const body = v.seats.length
          ? (one ? "one chamber of " : "two chambers: ") + v.seats.map(seat).join(" and ")
          : one
            ? "one chamber"
            : "two chambers";
        text(body);
        break;
      }
      case "independence": {
        let t = v.date;
        if (v.event) t += ` (${v.event})`;
        if (opts.from && v.from) t += `, from ${v.from}`;
        text(t);
        break;
      }
      case "holiday":
        blocks.push({
          id: field.id,
          label: field.label,
          kind: "text",
          parts: [
            ...(v.name
              ? [{ text: v.name, term: v.name, auto: true, why: /** @type {const} */ ("own") }]
              : []),
            ...plainParts((v.name ? ", " : "") + v.date),
          ],
        });
        break;
      case "memberships":
        blocks.push({ id: field.id, label: field.label, kind: "badges", badges: v });
        break;
      default:
        if (typeof v === "string") text(v);
    }
  }
  return blocks;
}

/* ═══════════════════════════════════════════════════════════
   Measuring and drawing
   ═══════════════════════════════════════════════════════════ */

const SANS = '"Inter", system-ui, sans-serif';
const SERIF = '"Source Serif 4", Georgia, serif';

/**
 * @typedef {object} Sizes
 * @property {number} label
 * @property {number} text
 * @property {number} line
 * @property {number} big
 * @property {number} small
 * @property {number} padTop
 * @property {number} padBottom
 */

/** @param {number} k @returns {Sizes} */
const sizesAt = (k) => ({
  label: 23 * k,
  text: 34 * k,
  line: 34 * k * 1.42,
  big: 46 * k,
  small: 23 * k,
  padTop: 20 * k,
  padBottom: 22 * k,
});

/**
 * The words and bars of a text, laid out in lines no wider than `w`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Part[]} parts
 * @param {number} w
 * @param {number} px
 * @param {(part: Part) => boolean} hidden
 * @returns {Array<Array<{text: string, bar: boolean, x: number, width: number}>>}
 */
function wrapParts(ctx, parts, w, px, hidden) {
  ctx.font = `400 ${px}px ${SANS}`;
  /** @type {Array<{text: string, bar: boolean, width: number, space: number}>} */
  const tokens = [];
  const spaceW = ctx.measureText(" ").width;
  for (const p of parts) {
    if (p.term && hidden(p)) {
      const width = Math.min(Math.max(ctx.measureText(p.text).width, px * 2.6), px * 5.5);
      // A trailing space in the text before decides the gap, so the bar
      // sits like a word.
      tokens.push({ text: "", bar: true, width, space: 0 });
      continue;
    }
    for (const m of p.text.matchAll(/(\s*)(\S+)(\s*)/g)) {
      if (m[1] && tokens.length) tokens[tokens.length - 1].space = spaceW;
      tokens.push({
        text: m[2],
        bar: false,
        width: ctx.measureText(m[2]).width,
        space: m[3] ? spaceW : 0,
      });
    }
  }
  /** @type {Array<Array<{text: string, bar: boolean, x: number, width: number}>>} */
  const lines = [[]];
  let x = 0;
  for (const t of tokens) {
    let line = lines[lines.length - 1];
    if (line.length && x + t.width > w) {
      line = [];
      lines.push(line);
      x = 0;
    }
    line.push({ text: t.text, bar: t.bar, x, width: t.width });
    x += t.width + t.space;
  }
  return lines;
}

/**
 * Badges laid out in rows.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} badges
 * @param {number} w
 * @param {number} px
 */
function badgeRows(ctx, badges, w, px) {
  ctx.font = `600 ${px}px ${SANS}`;
  const padX = px * 0.7;
  const gap = px * 0.5;
  /** @type {Array<Array<{text: string, x: number, width: number}>>} */
  const rows = [[]];
  let x = 0;
  for (const b of badges) {
    const width = ctx.measureText(b).width + padX * 2;
    if (rows[rows.length - 1].length && x + width > w) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push({ text: b, x, width });
    x += width + gap;
  }
  return rows;
}

/**
 * How tall a block is, at the given sizes and width.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Block} b
 * @param {number} w
 * @param {Sizes} s
 * @param {(part: Part) => boolean} hidden
 */
function blockHeight(ctx, b, w, s, hidden) {
  const head = s.padTop + s.label * 1.5;
  let body = 0;
  if (b.kind === "text") body = wrapParts(ctx, b.parts || [], w, s.text, hidden).length * s.line;
  else if (b.kind === "stats") body = s.big * 1.25 + s.small * 1.4;
  else if (b.kind === "bars") body = (b.bars || []).length * s.text * 1.05;
  else if (b.kind === "badges")
    body = badgeRows(ctx, b.badges || [], w, s.small).length * s.small * 2.4;
  return head + body + s.padBottom;
}

/**
 * Where to split the blocks into two columns, keeping their order: the
 * split that makes the taller column as short as possible.
 *
 * @param {number[]} heights
 * @returns {number} how many blocks go in the left column
 */
export function balance(heights) {
  const total = heights.reduce((a, b) => a + b, 0);
  let best = heights.length;
  let bestH = total;
  let left = 0;
  for (let k = 0; k <= heights.length; k++) {
    const h = Math.max(left, total - left);
    if (h < bestH) {
      bestH = h;
      best = k;
    }
    left += heights[k] || 0;
  }
  return best;
}

/**
 * Draw one block at `(x, y)`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Block} b
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {Sizes} s
 * @param {SheetOptions} o
 * @param {(part: Part) => boolean} hidden
 */
function drawBlock(ctx, b, x, y, w, s, o, hidden) {
  ctx.fillStyle = o.ink;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(x, y, w, Math.max(1, s.text * 0.06));
  ctx.globalAlpha = 1;
  let cy = y + s.padTop;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `600 ${s.label}px ${SANS}`;
  ctx.fillStyle = o.accent;
  const label = b.label.toUpperCase();
  ctx.letterSpacing = `${s.label * 0.11}px`;
  ctx.fillText(label, x, cy);
  const labelW = ctx.measureText(label).width;
  ctx.letterSpacing = "0px";
  if (b.tag) {
    ctx.font = `500 ${s.label * 0.9}px ${SANS}`;
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = o.ink;
    ctx.fillText(`· ${b.tag}`, x + labelW + s.label * 0.8, cy + s.label * 0.05);
    ctx.globalAlpha = 1;
  }
  cy += s.label * 1.5;

  if (b.kind === "text") {
    const lines = wrapParts(ctx, b.parts || [], w, s.text, hidden);
    ctx.font = `400 ${s.text}px ${SANS}`;
    for (const line of lines) {
      for (const t of line) {
        if (t.bar) {
          ctx.fillStyle = o.bar;
          roundRect(ctx, x + t.x, cy + s.line * 0.17, t.width, s.text * 0.88, s.text * 0.18);
        } else {
          ctx.fillStyle = o.ink;
          ctx.fillText(t.text, x + t.x, cy + (s.line - s.text) / 2);
        }
      }
      cy += s.line;
    }
  } else if (b.kind === "stats") {
    let sx = x;
    for (const st of b.stats || []) {
      ctx.font = `700 ${s.big}px ${SANS}`;
      ctx.fillStyle = o.ink;
      ctx.fillText(st.value, sx, cy);
      const vw = ctx.measureText(st.value).width;
      ctx.font = `400 ${s.small}px ${SANS}`;
      ctx.globalAlpha = 0.65;
      ctx.fillText(st.label, sx, cy + s.big * 1.25);
      const lw = ctx.measureText(st.label).width;
      ctx.globalAlpha = 1;
      sx += Math.max(vw, lw) + s.big;
    }
  } else if (b.kind === "bars") {
    const bars = b.bars || [];
    const max = Math.max(...bars, 1);
    const qW = s.text * 1.3;
    ctx.font = `400 ${s.text * 0.78}px ${SANS}`;
    const kmW = ctx.measureText("00,000 km").width + s.text * 0.5;
    const barMax = Math.max(10, w - qW - kmW);
    const rowH = s.text * 1.05;
    for (const km of bars) {
      ctx.font = `700 ${s.text * 0.8}px ${SANS}`;
      ctx.fillStyle = o.ink;
      ctx.globalAlpha = 0.6;
      ctx.textAlign = "center";
      ctx.fillText("?", x + qW / 2, cy + (rowH - s.text * 0.8) / 2);
      ctx.textAlign = "left";
      ctx.globalAlpha = 0.85;
      roundRect(
        ctx,
        x + qW,
        cy + rowH * 0.22,
        Math.max(2, (km / max) * barMax),
        rowH * 0.56,
        rowH * 0.12,
      );
      ctx.globalAlpha = 1;
      ctx.font = `400 ${s.text * 0.78}px ${SANS}`;
      ctx.fillText(`${n0(km)} km`, x + qW + barMax + s.text * 0.4, cy + (rowH - s.text * 0.78) / 2);
      cy += rowH;
    }
  } else if (b.kind === "badges") {
    const rows = badgeRows(ctx, b.badges || [], w, s.small);
    ctx.font = `600 ${s.small}px ${SANS}`;
    for (const row of rows) {
      for (const bd of row) {
        ctx.fillStyle = o.accent;
        ctx.globalAlpha = 0.14;
        roundRect(ctx, x + bd.x, cy + s.small * 0.3, bd.width, s.small * 1.8, s.small * 0.9);
        ctx.globalAlpha = 1;
        ctx.fillStyle = o.accent;
        ctx.fillText(bd.text, x + bd.x + s.small * 0.7, cy + s.small * 0.72);
      }
      cy += s.small * 2.4;
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  ctx.fill();
}

/**
 * Break `text` into lines no wider than `maxW` at the current font.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 */
function wrapText(ctx, text, maxW) {
  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? line + " " + word : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw the sheet onto `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} o
 * @param {Block[]} blocks
 * @param {(part: Part) => boolean} hidden whether a name is blacked out
 */
export function drawSheet(canvas, o, blocks, hidden) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, W, H);
  if (!o.transparent) {
    ctx.fillStyle = o.paper;
    ctx.fillRect(0, 0, W, H);
  }
  const unit = Math.min(W, H * 1.5) / 2400;
  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad;
  let bottom = H - pad;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (o.credit) {
    const px = Math.max(10, 21 * unit);
    ctx.font = `400 ${px}px ${SANS}`;
    ctx.fillStyle = o.ink;
    ctx.globalAlpha = 0.55;
    ctx.textAlign = "left";
    ctx.fillText(o.credit, pad, H - pad * 0.55);
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
  }
  if (o.caption) {
    let px = Math.round(66 * unit);
    ctx.font = `700 ${px}px ${SERIF}`;
    while (px > 14 && ctx.measureText(o.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `700 ${px}px ${SERIF}`;
    }
    ctx.fillStyle = o.ink;
    if (o.capTop) {
      ctx.fillText(o.caption, W / 2, top + px * 0.55);
      top += px * 1.7;
    } else {
      ctx.fillText(o.caption, W / 2, bottom - px * 0.55);
      bottom -= px * 1.7;
    }
  }
  if (o.note) {
    const px = Math.round(Math.max(11, 29 * unit));
    ctx.font = `400 ${px}px ${SANS}`;
    const lines = wrapText(ctx, o.note, (W - pad * 2) * 0.8).slice(0, 3);
    const lead = px * 1.35;
    const after = px * 0.6;
    const gap = o.noteTop ? 0 : px * 1.4;
    const first = o.noteTop ? top + lead / 2 : bottom - after - lines.length * lead + lead / 2;
    ctx.fillStyle = o.ink;
    ctx.globalAlpha = 0.7;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, first + i * lead));
    ctx.globalAlpha = 1;
    const height = lines.length * lead + after + gap;
    if (o.noteTop) top += height;
    else bottom -= height;
  }
  if (o.label) {
    const px = Math.round(34 * unit);
    ctx.font = `500 ${px}px ${SANS}`;
    ctx.fillStyle = o.ink;
    ctx.globalAlpha = 0.75;
    ctx.fillText(o.label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }
  top += 20 * unit;
  if (!blocks.length) return;

  // Two columns on a wide sheet, one on a tall one; shrink until it fits.
  const cols = W >= H * 1.1 ? 2 : 1;
  const gapX = W * 0.045;
  const colW = (W - pad * 2 - gapX * (cols - 1)) / cols;
  const room = bottom - top;
  let s = sizesAt(unit);
  let heights = blocks.map((b) => blockHeight(ctx, b, colW, s, hidden));
  let split = cols === 2 ? balance(heights) : blocks.length;
  for (let k = unit; k > unit * 0.35; k *= 0.94) {
    s = sizesAt(k);
    heights = blocks.map((b) => blockHeight(ctx, b, colW, s, hidden));
    split = cols === 2 ? balance(heights) : blocks.length;
    const left = heights.slice(0, split).reduce((a, b) => a + b, 0);
    const right = heights.slice(split).reduce((a, b) => a + b, 0);
    if (Math.max(left, right) <= room) break;
  }
  let y = top;
  blocks.forEach((b, i) => {
    if (i === split) y = top;
    const x = i < split ? pad : pad + colW + gapX;
    drawBlock(ctx, b, x, y, colW, s, o, hidden);
    y += heights[i];
  });
}
