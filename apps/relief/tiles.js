/**
 * Shaded relief — fetching elevation tiles and turning them into heights.
 *
 * Tiles are PNG images, but they are never shown: each is decoded on a
 * scratch canvas and read back as numbers. Decoded tiles are kept in a
 * small cache, so restyling or resizing a sheet doesn't fetch them again.
 */

import { CACHE_TILES, MAX_TILE_BYTES, PARALLEL, TILE_TIMEOUT_MS, tileUrl } from "./config.js";
import { decodeTerrarium } from "./terrain.js";

/** Decoded tiles by "z/x/y"; null when the tile couldn't be loaded. */
const cache = new Map();

/**
 * A decoded tile from the cache: heights, null if it failed, or undefined
 * if it hasn't been fetched.
 *
 * @param {string} key "z/x/y"
 * @returns {Float32Array | null | undefined}
 */
export const cachedTile = (key) => cache.get(key);

/** @param {string} key @param {Float32Array | null} value */
function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  // Oldest first in a Map: drop from the front.
  while (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value);
}

/**
 * Fetch one tile and read its heights.
 *
 * @param {string} key "z/x/y", with x already wrapped
 * @returns {Promise<Float32Array>}
 */
async function loadTile(key) {
  const [z, x, y] = key.split("/").map(Number);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TILE_TIMEOUT_MS);
  try {
    const r = await fetch(tileUrl(z, x, y), { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const blob = await r.blob();
    if (blob.size > MAX_TILE_BYTES || !/^image\/png$/.test(blob.type))
      throw new Error("not an elevation tile");
    // Heights live in the colour values, so the browser must not adjust them.
    const bmp = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    if (bmp.width !== 256 || bmp.height !== 256) throw new Error("not an elevation tile");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = /** @type {CanvasRenderingContext2D} */ (
      canvas.getContext("2d", { willReadFrequently: true })
    );
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return decodeTerrarium(ctx.getImageData(0, 0, 256, 256).data);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make sure every tile in `keys` is in the cache, a few at a time.
 *
 * @param {string[]} keys
 * @param {(done: number, total: number) => void} onProgress
 * @param {() => boolean} stale true once the result is no longer wanted
 * @returns {Promise<number>} how many tiles failed
 */
export async function ensureTiles(keys, onProgress, stale) {
  const todo = keys.filter((k) => cache.get(k) === undefined || cache.get(k) === null);
  let done = keys.length - todo.length;
  let failed = 0;
  onProgress(done, keys.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stale()) {
      const key = todo[next++];
      try {
        remember(key, await loadTile(key));
      } catch {
        // Retry once: a slow tile on a busy connection often arrives the second time.
        try {
          remember(key, await loadTile(key));
        } catch {
          remember(key, null);
          failed++;
        }
      }
      onProgress(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  // A tile the cache had to drop again counts as missing.
  for (const k of keys) if (cache.get(k) === undefined) failed++;
  return failed;
}
