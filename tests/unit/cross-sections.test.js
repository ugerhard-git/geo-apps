// Unit tests for Cross-sections' line and profile maths
// (apps/cross-sections/profile.js). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gridPoints,
  heightScale,
  highestPoint,
  insideIntervals,
  lineZoom,
  middleOf,
  pointTileKeys,
  readProfile,
  samplePoints,
  unwrapPolys,
} from "../../apps/cross-sections/profile.js";
import { heightAtPx, lonLatPx, tileKey } from "../../shared/terrain-tiles.js";

/** A square from (x, y) to (x + s, y + s), as one polygon. */
const square = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) => [
  [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y],
  ],
];

test("a line is cut exactly where it crosses the border", () => {
  const polys = [square(10, 40, 4)];
  assert.deepEqual(insideIntervals(polys, "we", 42), [[10, 14]]);
  assert.deepEqual(insideIntervals(polys, "sn", 12), [[40, 44]]);
  assert.deepEqual(insideIntervals(polys, "we", 45), []);
});

test("a hole and a second island make gaps; overlapping parts merge", () => {
  const withLake = [[...square(0, 0, 10), ...square(4, 4, 2)]];
  assert.deepEqual(insideIntervals(withLake, "we", 5), [
    [0, 4],
    [6, 10],
  ]);
  const islands = [square(20, 0, 2), square(0, 0, 10), square(9, 0, 3)];
  assert.deepEqual(insideIntervals(islands, "we", 1), [
    [0, 12],
    [20, 22],
  ]);
});

test("a country across the antimeridian stays in one piece", () => {
  const east = square(170, 60, 10); // up to 180°
  const west = square(-180, 60, 5); // from −180° on
  const polys = unwrapPolys([east, west]);
  assert.deepEqual(insideIntervals(polys, "we", 62), [[170, 185]]);
  // Others are left alone.
  const plain = [square(10, 40, 4)];
  assert.equal(unwrapPolys(plain), plain);
});

test("the middle of a country is the centre of its area", () => {
  const [lon, lat] = /** @type {[number, number]} */ (middleOf([square(10, 40, 4)]));
  assert.ok(Math.abs(lon - 12) < 1e-9 && Math.abs(lat - 42) < 1e-9);
  // A small island hardly moves it, whichever way its ring runs.
  const ccw = square(30, 40, 1)[0].slice().reverse();
  const m = /** @type {[number, number]} */ (middleOf([square(10, 40, 4), [ccw]]));
  assert.ok(m[0] > 12 && m[0] < 13.5, String(m[0]));
});

test("points keep the gaps at their true width", () => {
  const pts = samplePoints(
    "we",
    0,
    [
      [0, 1],
      [2, 3],
    ],
    100,
  );
  const runs = new Set(pts.map((p) => p.run));
  assert.equal(runs.size, 2);
  const last = pts[pts.length - 1];
  // Three degrees of longitude at the equator, gap included.
  assert.ok(Math.abs(last.km - 3 * 111.32) < 0.01);
  const firstOfSecond = /** @type {any} */ (pts.find((p) => p.run === 1));
  assert.ok(Math.abs(firstOfSecond.km - 2 * 111.32) < 0.01);
  // Along a meridian, degrees of latitude.
  const north = samplePoints("sn", 10, [[40, 41]], 10);
  assert.ok(Math.abs(north[north.length - 1].km - 110.57) < 0.01);
});

test("the zoom fits the spacing of the points, and the tile limit", () => {
  const pts = samplePoints("we", 45, [[0, 2]], 900);
  const z = lineZoom(pts, 14, 1000);
  assert.ok(z >= 9 && z <= 11, String(z));
  const capped = lineZoom(pts, 14, 2);
  assert.ok(pointTileKeys(pts, capped).length <= 2);
  assert.ok(capped < z);
});

/**
 * A fake set of tiles at zoom z: height = f(lon), the rest missing.
 *
 * @param {number} z
 * @param {(px: number) => number} f height from world pixel x
 * @param {string[]} keys
 */
function fakeTiles(z, f, keys) {
  /** @type {Map<string, Float32Array>} */
  const tiles = new Map();
  for (const key of keys) {
    const [, x] = key.split("/").map(Number);
    const t = new Float32Array(256 * 256);
    for (let row = 0; row < 256; row++)
      for (let col = 0; col < 256; col++) t[row * 256 + col] = f(x * 256 + col + 0.5);
    tiles.set(key, t);
  }
  return (/** @type {string} */ k) => tiles.get(k);
}

test("heights are read between pixels", () => {
  const z = 2;
  const keys = [tileKey(z, 1, 1), tileKey(z, 2, 1)];
  const tileAt = fakeTiles(z, (px) => px, keys);
  // A linear slope reads back exactly, also across a tile edge.
  assert.ok(Math.abs(heightAtPx(300.25, 300, z, tileAt) - 300.25) < 1e-3);
  assert.ok(Math.abs(heightAtPx(512.0, 300, z, tileAt) - 512) < 1e-3);
  assert.ok(Number.isNaN(heightAtPx(20, 300, z, tileAt)), "missing tile");
});

test("a profile reads each run, and a missing tile makes a gap", () => {
  const parts = /** @type {[number, number][]} */ ([
    [0, 10],
    [12, 20],
  ]);
  const pts = samplePoints("we", 10, parts, 200);
  const z = 4;
  const keys = pointTileKeys(pts, z);
  const tileAt = fakeTiles(z, () => 250, keys);
  const p = readProfile(pts, z, tileAt);
  assert.equal(p.runs.length, 2);
  assert.equal(p.max, 250);
  assert.equal(p.missing, 0);
  // Take away the tile under the first part.
  const [px, py] = lonLatPx(5, 10, z);
  const hole = tileKey(z, Math.floor(px / 256), Math.floor(py / 256));
  const p2 = readProfile(pts, z, (k) => (k === hole ? null : tileAt(k)));
  assert.ok(p2.missing > 0);
});

test("the highest point is found on the grid", () => {
  const polys = [square(0, 0, 10)];
  const grid = gridPoints(polys, { w: 0, s: 0, e: 10, n: 10 }, 10, 10);
  assert.equal(grid.length, 100);
  assert.ok(grid.every(([lon, lat]) => lon > 0 && lon < 10 && lat > 0 && lat < 10));
  const z = 3;
  const keys = pointTileKeys(
    grid.map(([lon, lat]) => ({ lon, lat, km: 0, run: 0 })),
    z,
  );
  const [peakX] = lonLatPx(7, 5, z);
  const tileAt = fakeTiles(z, (px) => 1000 - Math.abs(px - peakX) * 10, keys);
  const top = /** @type {[number, number]} */ (highestPoint(grid, z, tileAt));
  assert.ok(Math.abs(top[0] - 7) <= 0.5, String(top));
});

test("flat countries look flat on the shared scale; stretched, they fill it", () => {
  assert.deepEqual(heightScale(-7, 93, false, 6000), { bottom: 0, top: 6000, step: 1000 });
  // Higher ground raises the top; land well below the sea lowers the floor.
  assert.equal(heightScale(80, 8400, false, 6000).top, 9000);
  assert.equal(heightScale(-420, 1200, false, 6000).bottom, -500);
  const s = heightScale(-7, 93, true, 6000);
  assert.ok(s.bottom <= -7 && s.bottom > -50 && s.top >= 93 && s.top <= 120, JSON.stringify(s));
  assert.ok((s.top - s.bottom) / s.step <= 7);
});
