/**
 * Keyboard layouts — drawing the sheet: a keyboard, its legends, a caption.
 *
 * `drawSheet` is given everything it draws, so the preview and the export
 * are the same code.
 */

import { frameSpec } from "../../shared/sheet.js";
import { capFor, isNonLatin, keyboard } from "./keys.js";

/** @typedef {import("./keys.js").Side} Side */
/** @typedef {import("./keys.js").Shape} Shape */

/**
 * @typedef {object} SheetOptions
 * @property {Shape} shape
 * @property {boolean} shift Shift characters
 * @property {boolean} altgr AltGr characters
 * @property {boolean} latin Latin letters on non-Latin keyboards
 * @property {boolean} bottom the bottom row (Ctrl, Space…)
 * @property {string} bg background
 * @property {boolean} transparent
 * @property {string} key keycap colour
 * @property {string} ink legend colour
 * @property {string} accent second-script legend colour
 * @property {string} caption
 * @property {boolean} capTop
 * @property {string} label the layout's name, printed when not "" (reveals the answer)
 * @property {string} font canvas font stack
 */

/**
 * @typedef {object} SheetContent
 * @property {Record<string, string[]>} keys the layout's keys
 * @property {Record<string, string[]>} us the US layout's keys
 */

/**
 * `hex` darkened towards black by `k` (0–1).
 *
 * @param {string} hex #rrggbb
 * @param {number} k
 */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (/** @type {number} */ v) => Math.round(v * (1 - k));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/**
 * Draw the whole sheet onto `canvas`, resizing it to the chosen frame.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {SheetOptions} opts
 * @param {SheetContent} content
 */
export function drawSheet(canvas, opts, { keys, us }) {
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

  if (opts.caption) {
    let px = Math.round(H * 0.05);
    const font = () => `600 ${px}px ${opts.font}`;
    ctx.font = font();
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = font();
    }
    ctx.fillStyle = opts.ink === opts.key ? opts.accent : contrastInk(opts);
    const y = opts.capTop ? top + px * 0.6 : bottom - px * 0.6;
    ctx.fillText(opts.caption, W / 2, y);
    if (opts.capTop) top += px * 1.9;
    else bottom -= px * 1.9;
  }
  if (opts.label) {
    const px = Math.round(H * 0.032);
    ctx.font = `400 ${px}px ${opts.font}`;
    ctx.fillStyle = contrastInk(opts);
    ctx.globalAlpha = 0.75;
    ctx.fillText(opts.label, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.2;
  }

  const kb = keyboard(opts.shape, { bottom: opts.bottom, b11: !!keys.B11 });
  const u = Math.min((W - pad * 2) / kb.w, (bottom - top) / kb.h);
  if (u < 8) return;
  const ox = (W - kb.w * u) / 2;
  const oy = top + (bottom - top - kb.h * u) / 2;
  const nonLatin = isNonLatin(keys);

  for (const k of kb.keys) {
    const face = drawKey(ctx, k, u, ox, oy, opts);
    if (!k.pos) continue;
    const cap = capFor(k.pos, keys, us, nonLatin, opts);
    drawLegends(ctx, cap, face, u, opts, nonLatin);
  }
}

/**
 * The colour for text on the background (not on a key): the legend colour,
 * unless the keys are what makes it readable — then the key colour.
 *
 * @param {SheetOptions} opts
 */
function contrastInk(opts) {
  if (opts.transparent) return opts.ink;
  return lum(opts.ink) - lum(opts.bg) > 0.3 || lum(opts.bg) - lum(opts.ink) > 0.3
    ? opts.ink
    : opts.key;
}

/** @param {string} hex */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/**
 * Draw one keycap: a darker base with a lighter top face, both rounded.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./keys.js").KeyBox} k
 * @param {number} u
 * @param {number} ox
 * @param {number} oy
 * @param {SheetOptions} opts
 * @returns {{x: number, y: number, w: number, h: number}} the top face, for the legends
 */
function drawKey(ctx, k, u, ox, oy, opts) {
  const gap = u * 0.05;
  const r = u * 0.09;
  /**
   * A rounded polygon: filled after insetting by `inset + r`, then stroked
   * 2r wide with round joins.
   *
   * @param {Array<[number, number]>} pts in pixels, clockwise
   * @param {number} insetL
   * @param {number} insetT
   * @param {number} insetR
   * @param {number} insetB
   * @param {string} colour
   */
  const shape = (pts, insetL, insetT, insetR, insetB, colour) => {
    const moved = insetPolygon(pts, insetL + r, insetT + r, insetR + r, insetB + r);
    ctx.beginPath();
    moved.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = colour;
    ctx.lineJoin = "round";
    ctx.lineWidth = r * 2;
    ctx.fill();
    ctx.stroke();
  };

  const pts = /** @type {Array<[number, number]>} */ (
    (
      k.outline ||
      /** @type {Array<[number, number]>} */ ([
        [k.x, k.y],
        [k.x + k.w, k.y],
        [k.x + k.w, k.y + k.h],
        [k.x, k.y + k.h],
      ])
    ).map(([x, y]) => [ox + x * u, oy + y * u])
  );
  const g = gap / 2;
  shape(pts, g, g, g, g, shade(opts.key, 0.22));
  const lip = u * 0.07;
  const side = u * 0.06;
  shape(pts, g + side, g + u * 0.02, g + side, g + lip + u * 0.03, opts.key);

  // The face of the main (top-left) rectangle, for the legends.
  const x = ox + k.x * u + g + side;
  const y = oy + k.y * u + g + u * 0.02;
  return { x, y, w: k.w * u - 2 * (g + side), h: u - 2 * g - lip - u * 0.05 };
}

/**
 * Move every edge of an axis-aligned, clockwise polygon (screen coordinates,
 * y down) inwards: top edges down by `t`, right edges left by `r`, and so on.
 * Each corner takes its x from its vertical edge and its y from its
 * horizontal one, so the inner corner of an L works like any other.
 *
 * @param {Array<[number, number]>} pts
 * @param {number} l
 * @param {number} t
 * @param {number} r
 * @param {number} b
 * @returns {Array<[number, number]>}
 */
export function insetPolygon(pts, l, t, r, b) {
  const n = pts.length;
  /** @param {[number, number]} a @param {[number, number]} c */
  const edge = (a, c) => {
    if (a[1] === c[1]) return { axis: "y", d: c[0] > a[0] ? t : -b }; // → top, ← bottom
    return { axis: "x", d: c[1] > a[1] ? -r : l }; // ↓ right, ↑ left
  };
  return pts.map((v, i) => {
    const before = edge(pts[(i + n - 1) % n], v);
    const after = edge(v, pts[(i + 1) % n]);
    const dx = before.axis === "x" ? before.d : after.d;
    const dy = before.axis === "y" ? before.d : after.d;
    return /** @type {[number, number]} */ ([v[0] + dx, v[1] + dy]);
  });
}

/**
 * Print a keycap's legends inside its face.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./keys.js").Cap} cap
 * @param {{x: number, y: number, w: number, h: number}} f
 * @param {number} u
 * @param {SheetOptions} opts
 * @param {boolean} nonLatin the Latin legends are the secondary ones, so keep them small everywhere
 */
function drawLegends(ctx, cap, f, u, opts, nonLatin) {
  const p = u * 0.1;
  const two = !!cap.right;
  const inner = { x: f.x + p, y: f.y + p * 0.8, w: f.w - 2 * p, h: f.h - p * 1.6 };

  if (cap.left) {
    const main = !two && !nonLatin;
    side(ctx, cap.left, inner, "left", {
      letter: main ? 0.44 : 0.27,
      pair: main ? 0.3 : 0.22,
      maxW: two ? inner.w * 0.45 : inner.w * (cap.altgr ? 0.62 : 1),
      colour: opts.ink,
      weight: main ? 600 : 400,
      u,
      font: opts.font,
    });
  }
  if (cap.right) {
    // Hangul jamo and kana are small for their size; printed legends get more.
    const big = cap.printed ? 1.3 : 1;
    side(ctx, cap.right, inner, "right", {
      letter: 0.42 * big,
      pair: 0.34 * big,
      pairTop: 0.26 * big,
      maxW: cap.left ? inner.w * 0.55 : inner.w,
      colour: opts.accent,
      weight: 400,
      u,
      font: opts.font,
    });
  }
  if (cap.altgr) {
    ctx.globalAlpha = 0.72;
    side(ctx, cap.altgr, inner, "right", {
      letter: 0.22,
      pair: 0.22,
      maxW: inner.w * 0.4,
      colour: opts.ink,
      weight: 400,
      u,
      font: opts.font,
    });
    ctx.globalAlpha = 1;
  }
}

/**
 * One side of a keycap: a big letter top-left (or bottom-right on the
 * right), or a pair, shift on top.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Side} s
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {"left" | "right"} at
 * @param {{letter: number, pair: number, pairTop?: number, maxW: number, colour: string, weight: number, u: number, font: string}} o
 */
function side(ctx, s, box, at, o) {
  ctx.fillStyle = o.colour;
  ctx.textAlign = at;
  const x = at === "left" ? box.x : box.x + box.w;
  /**
   * @param {string} text
   * @param {number} size in key units
   * @param {"top" | "bottom"} row
   */
  const put = (
    /** @type {string} */ text,
    /** @type {number} */ size,
    /** @type {"top" | "bottom"} */ row,
    /** @type {number} */ maxH,
  ) => {
    if (!text) return;
    let px = size * o.u;
    ctx.font = `${o.weight} ${px}px ${o.font}`;
    let m = ctx.measureText(text);
    // Tall scripts (Thai marks, kana) are shrunk to their half of the cap.
    const tall = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const k = Math.min(1, o.maxW / (m.width || 1), maxH / (tall || 1));
    if (k < 1) {
      px *= k;
      ctx.font = `${o.weight} ${px}px ${o.font}`;
      m = ctx.measureText(text);
    }
    const up = m.actualBoundingBoxAscent;
    const down = m.actualBoundingBoxDescent;
    let y;
    if (row === "top") {
      y = box.y + px * 0.5;
      y = Math.min(Math.max(y, box.y + up), box.y + maxH - down);
    } else {
      y = box.y + box.h - px * 0.5;
      y = Math.max(Math.min(y, box.y + box.h - down), box.y + box.h - maxH + up);
    }
    ctx.fillText(text, x, y);
  };
  if (s.kind === "letter") put(s.ch, o.letter, at === "left" ? "top" : "bottom", box.h);
  else {
    put(s.top, o.pairTop || o.pair, "top", box.h * 0.48);
    put(s.bottom, o.pair, "bottom", box.h * 0.48);
  }
}
