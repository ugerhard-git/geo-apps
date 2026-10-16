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
  HEIGHT_SCHEMES,
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
  // The tiles under the grid, looked up once: by name per sample is slow.
  const tx0 = Math.floor((X0 - 1) / TILE);
  const tx1 = Math.floor((X0 + w * step + 1) / TILE);
  const ty0 = Math.floor(clamp(Y0 - 1, 0, rowsInWorld - 1) / TILE);
  const ty1 = Math.floor(clamp(Y0 + h * step + 1, 0, rowsInWorld - 1) / TILE);
  const cols = tx1 - tx0 + 1;
  /** @type {Array<Float32Array | null>} */
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) tiles.push(tileAt(tileKey(z, tx, ty)) || null);

  /** @param {number} X @param {number} Y whole world pixels */
  const at = (X, Y) => {
    const Yc = Y < 0 ? 0 : Y >= rowsInWorld ? rowsInWorld - 1 : Y;
    const tx = Math.floor(X / TILE);
    const ty = Math.floor(Yc / TILE);
    const t = tiles[(ty - ty0) * cols + (tx - tx0)];
    if (!t) return 0;
    const v = t[(Yc - ty * TILE) * TILE + (X - tx * TILE)];
    return v === v ? v : 0; // NaN reads as sea level
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

/** Where {@link gradient} leaves its result: east, north. Reused, so the
 *  millions of calls per sheet allocate nothing. */
const GRAD = new Float64Array(2);

/**
 * The slope at a pixel as east and north gradients (rise over run), left in
 * {@link GRAD}.
 *
 * @param {Float32Array} e heights
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} metres per row
 * @param {number} i
 * @param {number} j
 */
function gradient(e, w, h, metres, i, j) {
  const l = i > 0 ? i - 1 : i;
  const r = i < w - 1 ? i + 1 : i;
  const u = j > 0 ? j - 1 : j;
  const d = j < h - 1 ? j + 1 : j;
  const m = metres[j];
  GRAD[0] = (e[j * w + r] - e[j * w + l]) / ((r - l || 1) * m);
  // Rows run south, so north is up the column.
  GRAD[1] = (e[u * w + i] - e[d * w + i]) / ((d - u || 1) * m);
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
      gradient(e, w, h, metres, i, j);
      const gx = GRAD[0];
      const gy = GRAD[1];
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
      gradient(e, w, h, metres, i, j);
      const gx = GRAD[0];
      const gy = GRAD[1];
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
  const a = new Float32Array(w * h);
  for (let k = 0; k < a.length; k++) a[k] = mask[k];
  const b = new Float32Array(w * h);
  const span = 2 * r + 1;
  /**
   * One box blur along `count` lines of length `n`: element k of line `line`
   * is at `line * lineStep + k * step`.
   *
   * @param {Float32Array} src
   * @param {Float32Array} dst
   * @param {number} n
   * @param {number} count
   * @param {number} step
   * @param {number} lineStep
   */
  const pass = (src, dst, n, count, step, lineStep) => {
    for (let line = 0; line < count; line++) {
      const o = line * lineStep;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[o + (k < 0 ? 0 : k >= n ? n - 1 : k) * step];
      for (let k = 0; k < n; k++) {
        dst[o + k * step] = sum / span;
        const add = k + r + 1 < n ? k + r + 1 : n - 1;
        const drop = k - r > 0 ? k - r : 0;
        sum += src[o + add * step] - src[o + drop * step];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, b, w, h, 1, w); // along rows
    pass(b, a, h, w, w, 1); // along columns
  }
  const out = new Uint8Array(w * h);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(a[k]);
  return out;
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

/** @typedef {Array<[number, string]>} Ramp metres → "#rrggbb", rising */

/** The default scheme. */
export const DEFAULT_RAMP = HEIGHT_SCHEMES[0].ramp;

/**
 * A custom scheme from three colours, at the given heights.
 *
 * @param {string[]} colours "#rrggbb" for low, middle and high ground
 * @param {number[]} heights metres, rising
 * @returns {Ramp}
 */
export const customRamp = (colours, heights) =>
  heights.map((m, i) => /** @type {[number, string]} */ ([m, colours[i]]));

/**
 * The colour of a scheme at a height, blended between its steps.
 *
 * @param {number} metres
 * @param {Ramp} [ramp]
 * @returns {RGB}
 */
export function heightColour(metres, ramp = DEFAULT_RAMP) {
  const steps = ramp.map(([m, hex]) => /** @type {[number, RGB]} */ ([m, rgbOf(hex)]));
  if (metres <= steps[0][0]) return steps[0][1];
  for (let k = 1; k < steps.length; k++) {
    const [m1, c1] = steps[k];
    if (metres <= m1) {
      const [m0, c0] = steps[k - 1];
      const t = (metres - m0) / (m1 - m0);
      return [0, 1, 2].map((n) => c0[n] + (c1[n] - c0[n]) * t);
    }
  }
  return steps[steps.length - 1][1];
}

/** {@link heightColour} every 5 m from sea level to 9 km, as r, g, b. */
const HEIGHT_STEP = 5;
/** @type {Map<string, Uint8Array>} one table per scheme, built when first used */
const tables = new Map();

/** @param {Ramp} ramp */
function heightTable(ramp) {
  const key = JSON.stringify(ramp);
  let t = tables.get(key);
  if (!t) {
    const n = 9000 / HEIGHT_STEP + 1;
    t = new Uint8Array(n * 3);
    for (let k = 0; k < n; k++) t.set(heightColour(k * HEIGHT_STEP, ramp).map(Math.round), k * 3);
    if (tables.size > 20) tables.clear(); // custom colours change often
    tables.set(key, t);
  }
  return t;
}

/**
 * @typedef {object} Palette
 * @property {RGB} land flat ground (when not coloured by height)
 * @property {RGB} shadow
 * @property {RGB} light
 * @property {RGB} bg what shows where the mask is empty
 * @property {boolean} transparent where the mask is empty, nothing shows
 * @property {boolean} byHeight colour the ground by its height
 * @property {Ramp} ramp the colours by height
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
 * `shadow`. Where the mask is partly or wholly empty, `bg` shows through,
 * or with `transparent`, nothing: the mask becomes the pixels' opacity.
 *
 * @param {Uint8ClampedArray} out RGBA, w × h
 * @param {Float32Array} shade
 * @param {Float32Array} e heights
 * @param {Uint8Array | null} mask 0–255, or null for no mask
 * @param {Palette} p
 */
export function colourise(out, shade, e, mask, p) {
  const flat = FLAT_SHADE;
  const table = p.byHeight ? heightTable(p.ramp) : new Uint8Array(3);
  const last = table.length / 3 - 1;
  const base = [...p.land];
  for (let k = 0; k < shade.length; k++) {
    if (p.byHeight) {
      const m = e[k] / HEIGHT_STEP;
      const t = (m <= 0 ? 0 : m >= last ? last : Math.round(m)) * 3;
      base[0] = table[t];
      base[1] = table[t + 1];
      base[2] = table[t + 2];
    }
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
    if (p.transparent) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a * 255;
    } else {
      out[o] = p.bg[0] + (r - p.bg[0]) * a;
      out[o + 1] = p.bg[1] + (g - p.bg[1]) * a;
      out[o + 2] = p.bg[2] + (b - p.bg[2]) * a;
      out[o + 3] = 255;
    }
  }
}
