/**
 * Letter frequencies — drawing the sheet: one bar per letter, its letter
 * below, an optional caption, name and credit.
 *
 * `drawSheet` is given everything it draws, so the preview and the export
 * are the same code.
 */

import { frameSpec } from "../../shared/sheet.js";

/** @typedef {import("./data.js").Bar} Bar */

/**
 * @typedef {object} SheetOptions
 * @property {string} bar bar colour
 * @property {string} accent colour of letters beyond a–z, when highlighted
 * @property {boolean} highlight colour letters beyond a–z
 * @property {string} compareColour colour of the English comparison bars
 * @property {string} ink text colour
 * @property {string} bg background
 * @property {boolean} transparent
 * @property {boolean} values print each share above its bar
 * @property {boolean} upper print the letters as capitals
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} label the language's name, printed when not "" (reveals the answer)
 * @property {string} credit a credit line along the bottom, "" for none
 */

const FONT = '"Noto Sans", "Helvetica Neue", Arial, sans-serif';

/**
 * A letter as printed: a lone combining mark on a dotted circle; a capital
 * only when it is one letter (ß → ẞ, not "SS").
 *
 * @param {string} s
 * @param {boolean} upper
 */
export function printable(s, upper) {
  if (/^\p{M}$/u.test(s)) return "\u25CC" + s;
  if (!upper) return s;
  if (s === "\u00DF") return "\u1E9E";
  const u = s.toLocaleUpperCase();
  return [...u].length === 1 ? u : s;
}

/**
 * "12.3", "0.62", "0.04": three significant figures at most, and never "0".
 *
 * @param {number} p percent
 */
export function percentText(p) {
  if (p >= 10) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2).replace(/0$/, "");
  return p >= 0.01 ? p.toFixed(2) : "<0.01";
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {Bar[]} bars
 */
export function drawSheet(canvas, opts, bars) {
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
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = opts.ink;

  if (opts.credit) {
    const px = Math.max(10, Math.round(H * 0.016));
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.globalAlpha = 0.6;
    ctx.textAlign = "right";
    ctx.fillText(opts.credit, W - pad * 0.5, H - pad * 0.45);
    ctx.textAlign = "center";
    ctx.globalAlpha = 1;
  }
  if (opts.caption) {
    let px = Math.round(H * 0.05);
    const font = () => `600 ${px}px ${FONT}`;
    ctx.font = font();
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = font();
    }
    const y = opts.capTop ? top + px * 0.6 : bottom - px * 0.6;
    ctx.fillText(opts.caption, W / 2, y);
    if (opts.capTop) top += px * 2;
    else bottom -= px * 2;
  }
  if (opts.label) {
    const px = Math.round(H * 0.032);
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(opts.label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.2;
  }
  if (!bars.length) return;

  // Columns: a bar, its letter below, its share above.
  const n = bars.length;
  const slot = (W - pad * 2) / n;
  // Many bars (Vietnamese has ~85): the letters take turns on two rows, so
  // each can be twice as wide.
  const stagger = n > 40;
  const letterPx = Math.min(slot * (stagger ? 1.2 : 0.62), (bottom - top) * 0.07);
  const valuePx = Math.min(slot * 0.3, letterPx * 0.5);
  const base = bottom - letterPx * (stagger ? 2.8 : 1.6);
  const compare = bars.some((b) => b.english !== null);
  let ceiling = top + (opts.values ? valuePx * 1.8 : 0);
  if (compare) {
    // A key for the comparison bars only: naming the main language would
    // give the answer away.
    const px = Math.max(12, Math.min(letterPx * 0.75, H * 0.03));
    ctx.font = `400 ${px}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillStyle = opts.compareColour;
    ctx.fillRect(pad, top + px * 0.15, px * 0.8, px * 0.8);
    ctx.fillStyle = opts.ink;
    ctx.fillText("English", pad + px * 1.2, top + px * 0.6);
    ctx.textAlign = "center";
    ceiling = Math.max(ceiling, top + px * 2);
  }
  const max = Math.max(...bars.map((b) => Math.max(b.percent, b.english || 0)));
  // Side by side, the letter's own bar leads and English's is narrower.
  const barW = slot * (compare ? 0.44 : 0.72);
  const cmpW = slot * 0.28;
  const gap = slot * 0.04;

  // A faint baseline.
  ctx.fillStyle = opts.ink;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(pad, base, W - pad * 2, Math.max(1, H * 0.0015));
  ctx.globalAlpha = 1;

  bars.forEach((b, i) => {
    const cx = pad + slot * (i + 0.5);
    const h = Math.max(1, ((base - ceiling) * b.percent) / max);
    const colour = opts.highlight && b.extra ? opts.accent : opts.bar;
    ctx.fillStyle = colour;
    const paired = b.english !== null;
    const x = paired ? cx - (barW + gap + cmpW) / 2 : cx - barW / 2;
    roundTop(ctx, x, base - h, barW, h, Math.min(barW * 0.18, h / 2));
    if (paired) {
      const eh = Math.max(1, ((base - ceiling) * /** @type {number} */ (b.english)) / max);
      ctx.fillStyle = opts.compareColour;
      roundTop(ctx, x + barW + gap, base - eh, cmpW, eh, Math.min(cmpW * 0.18, eh / 2));
    }

    ctx.fillStyle = opts.highlight && b.extra ? opts.accent : opts.ink;
    ctx.font = `500 ${letterPx}px ${FONT}`;
    const row = stagger && i % 2 ? 1.1 : 0;
    if (row) {
      // A hairline from the bar down to its lower label.
      ctx.globalAlpha = 0.3;
      ctx.fillRect(cx - 0.5, base + letterPx * 0.3, 1, letterPx * 0.9);
      ctx.globalAlpha = 1;
    }
    ctx.fillText(printable(b.letter, opts.upper), cx, base + letterPx * (0.85 + row));
    if (opts.values) {
      ctx.fillStyle = opts.ink;
      ctx.globalAlpha = 0.75;
      ctx.font = `400 ${valuePx}px ${FONT}`;
      ctx.fillText(percentText(b.percent), x + barW / 2, base - h - valuePx * 0.8);
      ctx.globalAlpha = 1;
    }
  });
}

/**
 * A bar with rounded top corners.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundTop(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}
