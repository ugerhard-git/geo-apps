/**
 * Elevation tiles, shared by the apps that read heights (Shaded relief,
 * Cross-sections): where the tiles are, how they are addressed, and a small
 * cache of decoded tiles.
 *
 * The tiles are Mapzen's Terrain Tiles on AWS Open Data, in the "Terrarium"
 * encoding: PNG images whose red, green and blue hold a height in metres.
 * They are never shown. Each is decoded on a scratch canvas and kept as
 * numbers. Free, no key, and served to any site (the bucket sends
 * `Access-Control-Allow-Origin: *`).
 *
 * "World pixels" are the tiles' own grid at a zoom level: 256 × 2^z across
 * the world, x running east from the antimeridian, y running south from the
 * top of Web Mercator.
 *
 * @module shared/terrain-tiles
 */

import { clamp } from "./util.js";

export const TILE_HOST = "https://s3.amazonaws.com";
/** @param {number} z @param {number} x @param {number} y */
export const tileUrl = (z, x, y) =>
  `${TILE_HOST}/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Where the tiles' sources are credited, as their licences ask. */
export const TERRAIN_ATTRIBUTION_URL =
  "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
export const TERRAIN_CREDIT =
  "Elevation: Mapzen Terrain Tiles (SRTM, GMTED2010, ETOPO1, EU-DEM and others)";

/** Tiles exist from zoom 0 (the whole world) to 15; 14 is detailed enough. */
export const MAX_ZOOM = 14;
/** Tiles kept in memory (each holds 256 × 256 heights, 256 KB). */
export const CACHE_TILES = 160;
/** A tile is a small PNG; anything bigger than this isn't one. */
export const MAX_TILE_BYTES = 2_000_000;
/** Give up on a tile after this long. */
export const TILE_TIMEOUT_MS = 20_000;
/** Tiles fetched at the same time. */
export const PARALLEL = 8;

export const TILE = 256;

/* ═══════════════════════════════════════════════════════════
   Addressing
   ═══════════════════════════════════════════════════════════ */

/**
 * A point in the Web Mercator plane (radians, as in shared/projection.js:
 * x east, y north) in world pixels at zoom `z`.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {[number, number]}
 */
export function worldPx(x, y, z) {
  const size = TILE * 2 ** z;
  return [((x + Math.PI) / (2 * Math.PI)) * size, ((Math.PI - y) / (2 * Math.PI)) * size];
}

/**
 * A longitude and latitude in world pixels at zoom `z`.
 *
 * @param {number} lon degrees
 * @param {number} lat degrees, kept within Web Mercator's limits
 * @param {number} z
 * @returns {[number, number]}
 */
export function lonLatPx(lon, lat, z) {
  const phi = (clamp(lat, -85.05, 85.05) * Math.PI) / 180;
  return worldPx((lon * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + phi / 2)), z);
}

/**
 * The address of a tile, its column wrapped round the world.
 *
 * @param {number} z
 * @param {number} x
 * @param {number} y
 */
export function tileKey(z, x, y) {
  const n = 2 ** z;
  return `${z}/${((x % n) + n) % n}/${y}`;
}

/**
 * Heights from a Terrarium tile's pixels: red × 256 + green + blue / 256,
 * minus 32768, in metres.
 *
 * @param {Uint8ClampedArray} rgba
 * @returns {Float32Array}
 */
export function decodeTerrarium(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++)
    out[j] = rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
  return out;
}

/**
 * The height at a world pixel, read bilinearly from the tiles around it.
 *
 * @param {number} px world pixel x (any value: wrapped round the world)
 * @param {number} py world pixel y
 * @param {number} z
 * @param {(key: string) => Float32Array | null | undefined} tileAt
 * @returns {number} metres, or NaN where a tile is missing
 */
export function heightAtPx(px, py, z, tileAt) {
  const rows = TILE * 2 ** z;
  // Pixel centres sit at .5; read between the four nearest.
  const x = px - 0.5;
  const y = clamp(py - 0.5, 0, rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  /** @param {number} gx @param {number} gy */
  const at = (gx, gy) => {
    const t = tileAt(tileKey(z, Math.floor(gx / TILE), Math.floor(gy / TILE)));
    if (!t) return NaN;
    return t[(gy - Math.floor(gy / TILE) * TILE) * TILE + (gx - Math.floor(gx / TILE) * TILE)];
  };
  const y1 = Math.min(y0 + 1, rows - 1);
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x0 + 1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/* ═══════════════════════════════════════════════════════════
   Fetching, with a small cache
   ═══════════════════════════════════════════════════════════ */

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
    if (bmp.width !== TILE || bmp.height !== TILE) throw new Error("not an elevation tile");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TILE;
    const ctx = /** @type {CanvasRenderingContext2D} */ (
      canvas.getContext("2d", { willReadFrequently: true })
    );
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return decodeTerrarium(ctx.getImageData(0, 0, TILE, TILE).data);
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
