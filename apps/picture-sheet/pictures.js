/**
 * Picture Sheet — reading the visitor's own pictures.
 *
 * Nothing leaves the browser: a file is read where it is, checked, decoded
 * once, and kept as a smaller copy. Each file goes through the same steps:
 *
 *   1. its size in bytes is checked (MAX_FILE_BYTES);
 *   2. its first bytes say what it is and how large it is (files.js), so an
 *      SVG, a page or a damaged file is turned away, and so is a picture too
 *      large to decode safely, before the browser tries;
 *   3. the browser decodes it once, turned the right way up (photos taken
 *      sideways carry that in their EXIF data);
 *   4. a copy no longer than KEEP_SIDE on its longest side is kept, re-encoded,
 *      plus a thumbnail for the tray. The original is let go. Drawing the copy
 *      on a canvas leaves the original's metadata (a phone photo's location,
 *      say) behind, so it can't reach an exported sheet.
 *
 * Files are read one after another, never together, so only one full-size
 * picture is ever in memory.
 */

import { HEADER_BYTES, KEEP_SIDE, MAX_FILE_BYTES, THUMB_SIDE } from "./config.js";
import { checkHeader, fitWithin } from "./files.js";

/**
 * @typedef {object} Picture
 * @property {string} id
 * @property {string} fileName for the tray only, never on the sheet
 * @property {Blob} blob the copy kept, at most KEEP_SIDE on its longest side
 * @property {number} w the copy's width
 * @property {number} h its height
 * @property {HTMLCanvasElement} thumb for the tray
 * @property {string} label typed by the visitor, "" for none
 */

let nextId = 1;

/**
 * Draw `source` at `w` × `h` on a new canvas.
 *
 * @param {CanvasImageSource} source
 * @param {number} w
 * @param {number} h
 */
function scaled(source, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

/**
 * Encode a canvas: WebP keeps transparency and stays small; a browser that
 * can't write WebP hands back PNG instead, which is fine too.
 *
 * @param {HTMLCanvasElement} c
 * @returns {Promise<Blob>}
 */
const encode = (c) =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/webp", 0.92),
  );

/**
 * Read one file into a Picture, or say why it can't be used.
 *
 * @param {File} file
 * @returns {Promise<{picture: Picture} | {why: string}>}
 */
export async function readPicture(file) {
  if (!(file instanceof Blob)) return { why: "It isn't a file." };
  if (file.size > MAX_FILE_BYTES)
    return {
      why: `It is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
    };
  let head;
  try {
    head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  } catch {
    return { why: "It couldn't be read." };
  }
  const check = checkHeader(head);
  if (!check.ok) return { why: check.why };

  /** @type {ImageBitmap} */
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { why: "The browser couldn't open it, so it may be damaged." };
  }
  try {
    // The decoded picture must be the one the header promised (turned, perhaps).
    const big = Math.max(bitmap.width, bitmap.height);
    if (!bitmap.width || !bitmap.height || big > Math.max(check.w, check.h))
      return { why: "It doesn't match its own header, so it may be damaged." };
    const keep = fitWithin(bitmap.width, bitmap.height, KEEP_SIDE);
    const copy = scaled(bitmap, keep.w, keep.h);
    const t = fitWithin(keep.w, keep.h, THUMB_SIDE);
    const thumb = scaled(copy, t.w, t.h);
    const blob = await encode(copy);
    copy.width = copy.height = 0; // let the memory go now
    return {
      picture: {
        id: `p${nextId++}`,
        fileName: file instanceof File ? file.name : "Pasted picture",
        blob,
        w: keep.w,
        h: keep.h,
        thumb,
        label: "",
      },
    };
  } catch {
    return { why: "It couldn't be prepared for the sheet." };
  } finally {
    bitmap.close();
  }
}

/**
 * Decoded copies of the pictures on the sheet, by id. Only those on the sheet
 * are kept decoded; the rest stay compressed.
 */
export function createDecodedCache() {
  /** @type {Map<string, Promise<ImageBitmap>>} */
  const cache = new Map();
  return {
    /** @param {Picture} p */
    get(p) {
      let hit = cache.get(p.id);
      if (!hit) {
        hit = createImageBitmap(p.blob);
        cache.set(p.id, hit);
        hit.catch(() => cache.delete(p.id));
      }
      return hit;
    },
    /**
     * Let go of every decoded copy except those of `keep`.
     *
     * @param {Set<string>} keep ids
     */
    keepOnly(keep) {
      // Dropped, not closed: a drawing still under way may be using one.
      for (const id of [...cache.keys()]) if (!keep.has(id)) cache.delete(id);
    },
  };
}
