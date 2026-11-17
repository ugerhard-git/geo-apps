/**
 * Picture Sheet — telling what a file is, from its own bytes.
 *
 * Pure functions, so they can be tested without a browser. A file's name and
 * the type the browser reports come from the file's name, so they prove
 * nothing; the first bytes decide. Only JPEG, PNG, GIF and WebP pass. SVG
 * never does: it is a document that can carry scripts.
 *
 * The picture's size is read from its header too, so a picture too large to
 * decode safely is turned away before the browser tries.
 *
 * None of these functions throws, whatever bytes they are given.
 */

import { MAX_PIXELS, MAX_SIDE } from "./config.js";

/** @typedef {"jpeg" | "png" | "gif" | "webp"} Kind */

/**
 * @param {Uint8Array} b
 * @param {number} at
 * @param {string} text ASCII
 */
const has = (b, at, text) => {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
/** @param {Uint8Array} b @param {number} i */
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
/** @param {Uint8Array} b @param {number} i */
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
/** @param {Uint8Array} b @param {number} i */
const be32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
/** @param {Uint8Array} b @param {number} i */
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * What kind of picture the bytes start, or why they aren't one.
 *
 * @param {Uint8Array} b the first bytes of the file
 * @returns {{kind: Kind} | {error: string}}
 */
export function sniffType(b) {
  if (!(b instanceof Uint8Array) || b.length < 12)
    return { error: "It is too short to be a picture." };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "jpeg" };
  if (has(b, 0, "\x89PNG\r\n\x1a\n")) return { kind: "png" };
  if (has(b, 0, "GIF87a") || has(b, 0, "GIF89a")) return { kind: "gif" };
  if (has(b, 0, "RIFF") && has(b, 8, "WEBP")) return { kind: "webp" };
  if (has(b, 4, "ftyp"))
    return { error: "HEIC and AVIF pictures can't be used. Save it as JPEG or PNG first." };
  return { error: "It isn't a JPEG, PNG, GIF or WebP picture." };
}

/**
 * The picture's width and height as its header declares them.
 *
 * @param {Uint8Array} b the first bytes of the file
 * @param {Kind} kind
 * @returns {{w: number, h: number} | null} null if the header can't be read
 */
export function imageSize(b, kind) {
  try {
    if (kind === "png") {
      if (!has(b, 12, "IHDR") || b.length < 24) return null;
      return { w: be32(b, 16), h: be32(b, 20) };
    }
    if (kind === "gif") {
      if (b.length < 10) return null;
      return { w: le16(b, 6), h: le16(b, 8) };
    }
    if (kind === "webp") return webpSize(b);
    if (kind === "jpeg") return jpegSize(b);
  } catch {
    /* fall through */
  }
  return null;
}

/** @param {Uint8Array} b */
function webpSize(b) {
  if (has(b, 12, "VP8 ") && b.length >= 30) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: le16(b, 26) & 0x3fff, h: le16(b, 28) & 0x3fff };
  }
  if (has(b, 12, "VP8L") && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    return {
      w: 1 + (b0 | ((b1 & 0x3f) << 8)),
      h: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (has(b, 12, "VP8X") && b.length >= 30) return { w: 1 + le24(b, 24), h: 1 + le24(b, 27) };
  return null;
}

/** JPEG markers that start a frame and carry its size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Walk the JPEG's segments to its frame header. Every step moves forward, so
 * the walk ends however the bytes are arranged.
 *
 * @param {Uint8Array} b
 */
function jpegSize(b) {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    // Fill bytes: 0xFF repeated before a marker.
    while (m === 0xff && i + 2 < b.length) m = b[++i + 1];
    i += 2;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xd9 || m === 0xda) return null; // the end, or image data before any frame
    if (i + 2 > b.length) return null;
    const len = be16(b, i);
    if (len < 2) return null;
    if (SOF.has(m)) {
      if (i + 7 > b.length) return null;
      return { w: be16(b, i + 5), h: be16(b, i + 3) };
    }
    i += len;
  }
  return null;
}

/**
 * Whether a file's first bytes describe a picture this app will decode, and
 * if not, why not, in words for the visitor.
 *
 * @param {Uint8Array} head the first bytes of the file
 * @returns {{ok: true, kind: Kind, w: number, h: number} | {ok: false, why: string}}
 */
export function checkHeader(head) {
  const t = sniffType(head);
  if ("error" in t) return { ok: false, why: t.error };
  const size = imageSize(head, t.kind);
  if (!size) return { ok: false, why: "Its size couldn't be read, so it may be damaged." };
  const { w, h } = size;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1)
    return { ok: false, why: "It says it has no pixels, so it may be damaged." };
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS)
    return {
      ok: false,
      why: `It is too large (${w.toLocaleString("en-GB")} × ${h.toLocaleString("en-GB")} pixels). Make it smaller first.`,
    };
  return { ok: true, kind: t.kind, w, h };
}

/**
 * The size to keep a picture at: no side longer than `side`, never enlarged.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} side
 */
export function fitWithin(w, h, side) {
  const s = Math.min(1, side / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * What is printed under a picture: its number, its label, both or neither.
 *
 * @param {number} index 0 for the first picture on the sheet
 * @param {string} label already cleaned
 * @param {{numbers: boolean, labels: boolean}} show
 */
export function sheetLabel(index, label, show) {
  const text = show.labels ? label : "";
  if (!show.numbers) return text;
  return text ? `${index + 1}. ${text}` : String(index + 1);
}
