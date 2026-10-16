/**
 * Shaded relief — the terrain maths: which tiles a view needs, reading
 * heights out of them, shading slopes and colouring the result.
 *
 * Pure functions on typed arrays, so they can be tested without a browser.
 *
 * Coordinates: the plane is Web Mercator in radians, as in
 * shared/projection.js (x east, y north). "World pixels" are the tiles'
 * own grid at a zoom level: 256 × 2^z across the world, y running south.
 */

import {
  HEIGHT_RAMP,
  LIGHTS,
  MAX_EXAGGERATION,
  MIN_EXAGGERATION,
  TARGET_SLOPE_DEG,
} from "./config.js";
import { clamp } from "../../shared/util.js";

/** @typedef {import("../../shared/projection.js").Box} Box */
/** @typedef {[number, number, number]} RGB */

const TILE = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/* ═══════════════════════════════════════════════════════════
   Tiles
   ═══════════════════════════════════════════════════════════ */

/**
 * A plane point in world pixels at zoom `z`.
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
 * The tiles a box in the plane touches. Columns are not wrapped yet: a
 * country moved east past the antimeridian has columns beyond the world's
 * last one, which {@link tileKey} wraps round.
 *
 * @param {Box} box
 * @param {number} z
 * @returns {{x0: number, x1: number, y0: number, y1: number, count: number}}
 */
export function tileRange(box, z) {
  const [px0, py0] = worldPx(box.x0, box.y1, z);
  const [px1, py1] = worldPx(box.x1, box.y0, z);
  const last = 2 ** z - 1;
  const x0 = Math.floor(px0 / TILE);
  const x1 = Math.floor((px1 - 1e-9) / TILE);
  const y0 = clamp(Math.floor(py0 / TILE), 0, last);
  const y1 = clamp(Math.floor((py1 - 1e-9) / TILE), 0, last);
  return { x0, x1, y0, y1, count: Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1) };
}

/**
 * The zoom whose tiles are at least as sharp as the sheet, unless that
 * needs more than `maxTiles` tiles; then the sharpest that doesn't.
 *
 * @param {number} pxPerUnit sheet pixels per plane unit (radian)
 * @param {Box} box the part of the plane that needs heights
 * @param {number} maxZoom
 * @param {number} maxTiles
 */
export function chooseZoom(pxPerUnit, box, maxZoom, maxTiles) {
  let z = clamp(Math.ceil(Math.log2((pxPerUnit * 2 * Math.PI) / TILE)), 0, maxZoom);
  while (z > 0 && tileRange(box, z).count > maxTiles) z--;
  return z;
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
 * Every tile a box needs, by key.
 *
 * @param {Box} box
 * @param {number} z
 * @returns {string[]}
 */
export function tileKeys(box, z) {
  const r = tileRange(box, z);
  /** @type {string[]} */
  const keys = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) keys.push(tileKey(z, x, y));
  return [...new Set(keys)];
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

/* ═══════════════════════════════════════════════════════════
   Sampling
   ═══════════════════════════════════════════════════════════ */

/**
 * @typedef {object} Grid
 * @property {number} w columns
 * @property {number} h rows
 * @property {number} z zoom of the tiles read
 * @property {number} X0 world pixel x of the first column's centre
 * @property {number} Y0 world pixel y of the first row's centre
 * @property {number} step world pixels per grid pixel
 */

/**
 * Heights for every pixel of a grid, read bilinearly from the tiles. A
 * missing tile reads as sea level.
 *
 * @param {Grid} grid
 * @param {(key: string) => Float32Array | null | undefined} tileAt
 * @returns {Float32Array}
 */
export function sampleHeights(grid, tileAt) {
  const { w, h, z, X0, Y0, step } = grid;
  const out = new Float32Array(w * h);
  const rowsInWorld = TILE * 2 ** z;
  /** @type {Map<string, Float32Array | null>} */
  const local = new Map();
  /** @param {number} X @param {number} Y */
  const at = (X, Y) => {
    const Yc = clamp(Y, 0, rowsInWorld - 1);
    const tx = Math.floor(X / TILE);
    const ty = Math.floor(Yc / TILE);
    const key = tileKey(z, tx, ty);
    let t = local.get(key);
    if (t === undefined) {
      t = tileAt(key) || null;
      local.set(key, t);
    }
    if (!t) return 0;
    const v = t[(Yc - ty * TILE) * TILE + (X - tx * TILE)];
    return Number.isFinite(v) ? v : 0;
  };
  for (let j = 0; j < h; j++) {
    const Y = Y0 + j * step - 0.5;
    const y0 = Math.floor(Y);
    const fy = Y - y0;
    for (let i = 0; i < w; i++) {
      const X = X0 + i * step - 0.5;
      const x0 = Math.floor(X);
      const fx = X - x0;
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      out[j * w + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

/**
 * The ground width of one grid pixel in each row, in metres: Web Mercator
 * enlarges everything by 1 / cos(latitude).
 *
 * @param {Grid} grid
 * @returns {Float64Array}
 */
export function rowMetres(grid) {
  const out = new Float64Array(grid.h);
  const size = TILE * 2 ** grid.z;
  for (let j = 0; j < grid.h; j++) {
    const Y = grid.Y0 + j * grid.step;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / size)));
    out[j] = (EARTH_CIRCUMFERENCE_M / size) * Math.cos(lat) * grid.step;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Shading
   ═══════════════════════════════════════════════════════════ */

/**
 * The slope at a pixel as east and north gradients (rise over run).
 *
 * @param {Float32Array} e heights
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} metres per row
 * @param {number} i
 * @param {number} j
 * @returns {[number, number]}
 */
function gradient(e, w, h, metres, i, j) {
  const l = i > 0 ? i - 1 : i;
  const r = i < w - 1 ? i + 1 : i;
  const u = j > 0 ? j - 1 : j;
  const d = j < h - 1 ? j + 1 : j;
  const m = metres[j];
  const east = (e[j * w + r] - e[j * w + l]) / ((r - l || 1) * m);
  // Rows run south, so north is up the column.
  const north = (e[u * w + i] - e[d * w + i]) / ((d - u || 1) * m);
  return [east, north];
}

/**
 * How bright flat ground is under {@link LIGHTS}: the tone every level
 * surface gets, whatever its height.
 */
export const FLAT_SHADE = LIGHTS.reduce(
  (s, l) => s + l.weight * Math.sin((l.altitude * Math.PI) / 180),
  0,
);

/**
 * The steepness that a share `q` of the pixels stays below, as rise over
 * run. Only pixels inside the mask count, when one is given.
 *
 * @param {Float32Array} e heights
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} metres
 * @param {Uint8Array | null} mask
 * @param {number} q 0–1
 */
export function slopeQuantile(e, w, h, metres, mask, q) {
  /** @type {number[]} */
  const slopes = [];
  const every = Math.max(1, Math.round(Math.sqrt((w * h) / 200_000)));
  for (let j = 0; j < h; j += every)
    for (let i = 0; i < w; i += every) {
      if (mask && mask[j * w + i] < 128) continue;
      const [gx, gy] = gradient(e, w, h, metres, i, j);
      slopes.push(Math.hypot(gx, gy));
    }
  if (!slopes.length) return 0;
  slopes.sort((a, b) => a - b);
  return slopes[Math.min(slopes.length - 1, Math.floor(q * slopes.length))];
}

/**
 * The height exaggeration that tilts slopes of steepness `slope` to
 * {@link TARGET_SLOPE_DEG}.
 *
 * @param {number} slope rise over run
 */
export function autoExaggeration(slope) {
  if (!(slope > 0)) return MAX_EXAGGERATION;
  const k = Math.tan((TARGET_SLOPE_DEG * Math.PI) / 180) / slope;
  return clamp(k, MIN_EXAGGERATION, MAX_EXAGGERATION);
}

/**
 * Brightness of every pixel under {@link LIGHTS}, 0 (facing away) to 1
 * (facing the light).
 *
 * @param {Float32Array} e heights
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} metres
 * @param {number} exaggeration
 * @returns {Float32Array}
 */
export function hillshade(e, w, h, metres, exaggeration) {
  const lights = LIGHTS.map((l) => {
    const az = (l.azimuth * Math.PI) / 180;
    const alt = (l.altitude * Math.PI) / 180;
    return {
      x: Math.sin(az) * Math.cos(alt),
      y: Math.cos(az) * Math.cos(alt),
      z: Math.sin(alt),
      weight: l.weight,
    };
  });
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const [gx, gy] = gradient(e, w, h, metres, i, j);
      // The surface normal, tilted against the slope.
      const nx = -gx * exaggeration;
      const ny = -gy * exaggeration;
      const len = Math.hypot(nx, ny, 1);
      let s = 0;
      for (const l of lights) s += l.weight * Math.max(0, (nx * l.x + ny * l.y + l.z) / len);
      out[j * w + i] = s;
    }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Masks
   ═══════════════════════════════════════════════════════════ */

/**
 * Soften a mask's edge: three box blurs, close to a Gaussian.
 *
 * @param {Uint8Array} mask 0–255
 * @param {number} w
 * @param {number} h
 * @param {number} radius in pixels
 * @returns {Uint8Array}
 */
export function blurMask(mask, w, h, radius) {
  const r = Math.max(0, Math.round(radius / 1.7));
  if (!r) return mask.slice();
  const a = Float32Array.from(mask);
  const b = new Float32Array(w * h);
  const pass = (/** @type {Float32Array} */ src, /** @type {Float32Array} */ dst, horiz) => {
    const n = horiz ? w : h;
    const lines = horiz ? h : w;
    for (let line = 0; line < lines; line++) {
      const idx = (/** @type {number} */ k) => (horiz ? line * w + k : k * w + line);
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[idx(clamp(k, 0, n - 1))];
      for (let k = 0; k < n; k++) {
        dst[idx(k)] = sum / (2 * r + 1);
        sum += src[idx(Math.min(n - 1, k + r + 1))] - src[idx(Math.max(0, k - r))];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, b, true);
    pass(b, a, false);
  }
  return Uint8Array.from(a, (v) => Math.round(v));
}

/**
 * The height of the country's lowest ground along its edge (the coast, or
 * the lowest point of its land border), ignoring the lowest 2% as noise.
 *
 * @param {Float32Array} e heights
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 */
export function lowestEdgeHeight(e, mask, w, h) {
  /** @type {number[]} */
  const edge = [];
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (mask[k] < 128) continue;
      if (mask[k - 1] < 128 || mask[k + 1] < 128 || mask[k - w] < 128 || mask[k + w] < 128)
        edge.push(e[k]);
    }
  if (!edge.length) return 0;
  edge.sort((a, b) => a - b);
  return Math.max(0, edge[Math.floor(edge.length * 0.02)]);
}

/* ═══════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {string} hex "#rrggbb"
 * @returns {RGB}
 */
export function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RAMP = HEIGHT_RAMP.map(([m, hex]) => /** @type {[number, RGB]} */ ([m, rgbOf(hex)]));

/**
 * The atlas colour for a height.
 *
 * @param {number} metres
 * @returns {RGB}
 */
export function heightColour(metres) {
  if (metres <= RAMP[0][0]) return RAMP[0][1];
  for (let k = 1; k < RAMP.length; k++) {
    const [m1, c1] = RAMP[k];
    if (metres <= m1) {
      const [m0, c0] = RAMP[k - 1];
      const t = (metres - m0) / (m1 - m0);
      return [0, 1, 2].map((n) => c0[n] + (c1[n] - c0[n]) * t);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * @typedef {object} Palette
 * @property {RGB} land flat ground (when not coloured by height)
 * @property {RGB} shadow
 * @property {RGB} light
 * @property {RGB} bg what shows where the mask is empty
 * @property {boolean} byHeight colour the ground by its height
 * @property {number} contrast multiplies {@link SHADOW_GAIN} and {@link LIGHT_GAIN}
 */

/**
 * How quickly slopes move from the ground colour towards the shadow and the
 * light colour, per unit of brightness away from flat ground. Tuned so a
 * 30° slope facing away from the light is clearly dark, and highlights stay
 * a little softer than shadows, as on a printed relief map.
 */
export const SHADOW_GAIN = 2.6;
export const LIGHT_GAIN = 3.2;

/**
 * Colour the terrain into RGBA pixels. Flat ground gets exactly the ground
 * colour; slopes towards the light move to `light`, slopes away to
 * `shadow`. Where the mask is partly or wholly empty, `bg` shows through.
 *
 * @param {Uint8ClampedArray} out RGBA, w × h
 * @param {Float32Array} shade
 * @param {Float32Array} e heights
 * @param {Uint8Array | null} mask 0–255, or null for no mask
 * @param {Palette} p
 */
export function colourise(out, shade, e, mask, p) {
  const flat = FLAT_SHADE;
  for (let k = 0; k < shade.length; k++) {
    const base = p.byHeight ? heightColour(e[k]) : p.land;
    const s = shade[k];
    let r, g, b;
    if (s < flat) {
      const t = Math.min(1, (flat - s) * SHADOW_GAIN * p.contrast);
      r = base[0] + (p.shadow[0] - base[0]) * t;
      g = base[1] + (p.shadow[1] - base[1]) * t;
      b = base[2] + (p.shadow[2] - base[2]) * t;
    } else {
      const t = Math.min(1, (s - flat) * LIGHT_GAIN * p.contrast);
      r = base[0] + (p.light[0] - base[0]) * t;
      g = base[1] + (p.light[1] - base[1]) * t;
      b = base[2] + (p.light[2] - base[2]) * t;
    }
    const a = mask ? mask[k] / 255 : 1;
    const o = k * 4;
    out[o] = p.bg[0] + (r - p.bg[0]) * a;
    out[o + 1] = p.bg[1] + (g - p.bg[1]) * a;
    out[o + 2] = p.bg[2] + (b - p.bg[2]) * a;
    out[o + 3] = 255;
  }
}
