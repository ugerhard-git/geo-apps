/**
 * Baby names — drawing the sheet: one or two numbered lists, and a source
 * block that says plainly what each list is and how old it is.
 *
 * `drawSheet` is given everything it draws, so the preview and the export
 * are the same code.
 */

import { frameSpec } from "../../shared/sheet.js";
import { basisText, shown, topEntries, warningOf } from "./data.js";

/** @typedef {import("./data.js").NameList} NameList */

/**
 * @typedef {object} SheetOptions
 * @property {"latin" | "native" | "both"} script
 * @property {number} count how many places per list
 * @property {boolean} ranks print the numbers
 * @property {string} ink text colour
 * @property {string} accent headings and numbers
 * @property {string} bg background
 * @property {boolean} transparent
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} label the country's name, printed when not "" (reveals the answer)
 * @property {boolean} sourceLine print the source block
 * @property {string} font canvas font stack
 */

/**
 * @typedef {object} Column
 * @property {string} title "Girls" / "Boys"
 * @property {NameList} list
 */

/**
 * The source block's lines: where the names come from, then what each list
 * is, with its warning.
 *
 * @param {Column[]} columns
 * @param {string} licence
 * @returns {Array<{text: string, warn: boolean}>}
 */
export function sourceLines(columns, licence) {
  /** @type {Array<{text: string, warn: boolean}>} */
  const out = [
    { text: `Names: Wikipedia, “List of most popular given names” · ${licence}`, warn: false },
  ];
  for (const c of columns) {
    const warning = warningOf(c.list);
    out.push({
      text: `${c.title}: ${basisText(c.list)}${warning ? " — ⚠ " + warning : ""}`,
      warn: !!warning,
    });
  }
  return out;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {{columns: Column[], licence: string}} content
 */
export function drawSheet(canvas, opts, { columns, licence }) {
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
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // The source block sits at the bottom, under everything else.
  if (opts.sourceLine && columns.length) {
    const lines = sourceLines(columns, licence);
    const px = Math.max(11, Math.round(H * 0.018));
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.font = `400 ${px}px ${opts.font}`;
      ctx.fillStyle = lines[i].warn ? opts.accent : opts.ink;
      ctx.globalAlpha = lines[i].warn ? 0.95 : 0.6;
      let size = px;
      while (size > 8 && ctx.measureText(lines[i].text).width > W - pad * 2) {
        size -= 1;
        ctx.font = `400 ${size}px ${opts.font}`;
      }
      ctx.fillText(lines[i].text, W / 2, bottom - px * 0.6);
      bottom -= px * 1.45;
    }
    ctx.globalAlpha = 1;
    bottom -= px * 0.8;
  }

  if (opts.caption) {
    let px = Math.round(H * 0.05);
    ctx.font = `600 ${px}px ${opts.font}`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px ${opts.font}`;
    }
    ctx.fillStyle = opts.ink;
    const y = opts.capTop ? top + px * 0.6 : bottom - px * 0.6;
    ctx.fillText(opts.caption, W / 2, y);
    if (opts.capTop) top += px * 2;
    else bottom -= px * 2;
  }
  if (opts.label) {
    const px = Math.round(H * 0.032);
    ctx.font = `400 ${px}px ${opts.font}`;
    ctx.fillStyle = opts.ink;
    ctx.globalAlpha = 0.75;
    ctx.fillText(opts.label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.2;
  }
  if (!columns.length) return;

  // Columns side by side, each a heading and its numbered lines.
  const gap = pad;
  const colW = (W - pad * 2 - gap * (columns.length - 1)) / columns.length;
  const rows = columns.map((c) => topEntries(c.list, opts.count));
  const most = Math.max(...rows.map((r) => r.length), 1);
  const lineH = Math.min((bottom - top) / (most + 1.6), H * 0.075);
  let px = Math.round(lineH * 0.62);

  // One size for every line on the sheet: the largest at which all fit,
  // the rank numbers included (their column grows with the size).
  const lineText = (/** @type {import("./data.js").Entry} */ e) =>
    e.names.map((n) => shown(n, opts.script)).join(" · ");
  const numFor = (/** @type {number} */ size) => (opts.ranks ? size * 1.9 : 0);
  const widest = (/** @type {number} */ size) => {
    ctx.font = `500 ${size}px ${opts.font}`;
    return Math.max(0, ...rows.flat().map((e) => ctx.measureText(lineText(e)).width));
  };
  while (px > 10 && widest(px) + numFor(px) > colW) px -= 1;
  const num = numFor(px);

  const blockH = lineH * (most + 1.6);
  const y0 = top + Math.max(0, (bottom - top - blockH) / 2);
  columns.forEach((c, ci) => {
    const x0 = pad + ci * (colW + gap);
    ctx.font = `500 ${px}px ${opts.font}`;
    const textW = num + Math.max(0, ...rows[ci].map((e) => ctx.measureText(lineText(e)).width));
    // Each list is centred in its column, its lines aligned on the left.
    const left = x0 + Math.max(0, (colW - textW) / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = opts.accent;
    ctx.font = `700 ${Math.round(px * 0.8)}px ${opts.font}`;
    ctx.fillText(c.title.toUpperCase(), left, y0 + lineH * 0.5);
    rows[ci].forEach((e, i) => {
      const y = y0 + lineH * (i + 1.6);
      if (opts.ranks) {
        ctx.textAlign = "right";
        ctx.fillStyle = opts.accent;
        ctx.font = `600 ${Math.round(px * 0.85)}px ${opts.font}`;
        const prev = rows[ci][i - 1];
        const tied = e.names.length > 1 || (prev && prev.rank === e.rank);
        ctx.fillText(
          c.list.unranked ? "•" : `${e.rank}${tied ? "=" : "."}`,
          left + num - px * 0.45,
          y,
        );
      }
      ctx.textAlign = "left";
      ctx.fillStyle = opts.ink;
      ctx.font = `500 ${px}px ${opts.font}`;
      ctx.fillText(lineText(e), left + num, y);
    });
  });
}
