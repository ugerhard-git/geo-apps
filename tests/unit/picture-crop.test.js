// Unit tests for Picture Sheet's cropping (apps/picture-sheet/crop.js): every
// rectangle stays inside the picture and keeps its minimum size. Run with
// `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cropPixels, dragCrop, isWhole, normalise, nudge } from "../../apps/picture-sheet/crop.js";

const MIN = { w: 0.05, h: 0.05 };
/** @param {any} c */
/** Equal to within rounding. @param {any} a @param {any} b */
const close = (a, b) => {
  assert.ok(a, "a rectangle");
  for (const k of ["x", "y", "w", "h"])
    assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} ≠ ${b[k]}`);
};
/** @param {any} c */
const inside = (c) =>
  c.x >= 0 && c.y >= 0 && c.w > 0 && c.h > 0 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9;

test("a crop is made safe, or refused", () => {
  close(normalise({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), {
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
  });
  // Hanging over the edge: cut to the picture.
  const over = /** @type {any} */ (normalise({ x: 0.8, y: -0.2, w: 0.5, h: 0.5 }));
  assert.ok(inside(over));
  assert.ok(Math.abs(over.w - 0.2) < 1e-9 && Math.abs(over.h - 0.3) < 1e-9);
  // Drawn backwards: turned round.
  close(normalise({ x: 0.5, y: 0.5, w: -0.25, h: -0.25 }), {
    x: 0.25,
    y: 0.25,
    w: 0.25,
    h: 0.25,
  });
  for (const bad of [
    null,
    undefined,
    "crop",
    7,
    {},
    { x: NaN, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: Infinity, h: 1 },
    { x: 0, y: 0, w: 0, h: 0.5 },
    { x: 2, y: 2, w: 1, h: 1 },
    { x: "0", y: 0, w: 1, h: 1 },
  ])
    assert.equal(normalise(bad), null, JSON.stringify(bad));
  assert.ok(isWhole(null));
  assert.ok(isWhole({ x: 0, y: 0, w: 1, h: 1 }));
  assert.ok(!isWhole({ x: 0, y: 0, w: 0.5, h: 1 }));
});

test("a crop in pixels is whole pixels, at least one, inside the picture", () => {
  assert.deepEqual(cropPixels(null, 4000, 3000), { sx: 0, sy: 0, sw: 4000, sh: 3000 });
  assert.deepEqual(cropPixels({ x: 0.5, y: 0.5, w: 0.25, h: 0.1 }, 4000, 3000), {
    sx: 2000,
    sy: 1500,
    sw: 1000,
    sh: 300,
  });
  // A sliver still gives a pixel; the far edge never passes the picture's.
  assert.deepEqual(cropPixels({ x: 0.9999, y: 0.9999, w: 0.0001, h: 0.0001 }, 100, 100), {
    sx: 99,
    sy: 99,
    sw: 1,
    sh: 1,
  });
  let seed = 7;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  for (let n = 0; n < 3000; n++) {
    const W = 1 + Math.floor(rand() * 5000);
    const H = 1 + Math.floor(rand() * 5000);
    const c = {
      x: rand() * 1.4 - 0.2,
      y: rand() * 1.4 - 0.2,
      w: rand() * 1.4 - 0.2,
      h: rand() * 1.4 - 0.2,
    };
    const p = cropPixels(c, W, H);
    assert.ok(Number.isInteger(p.sx) && Number.isInteger(p.sw) && p.sw >= 1 && p.sh >= 1);
    assert.ok(
      p.sx >= 0 && p.sy >= 0 && p.sx + p.sw <= W && p.sy + p.sh <= H,
      JSON.stringify({ c, W, H, p }),
    );
  }
});

test("drawing a new rectangle: too small counts as no drag", () => {
  assert.equal(dragCrop(null, "new", { x: 0.5, y: 0.5 }, { x: 0.51, y: 0.52 }, MIN), null);
  assert.deepEqual(dragCrop(null, "new", { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 }, MIN), {
    x: 0.2,
    y: 0.3,
    w: 0.6000000000000001,
    h: 0.6000000000000001,
  });
  // Dragged off the picture: stops at its edge.
  const off = /** @type {any} */ (
    dragCrop(null, "new", { x: 0.5, y: 0.5 }, { x: 1.7, y: -3 }, MIN)
  );
  assert.ok(inside(off));
  assert.equal(off.x + off.w, 1);
  assert.equal(off.y, 0);
});

test("moving and resizing keep the rectangle inside and no smaller than the minimum", () => {
  const start = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
  const moved = /** @type {any} */ (
    dragCrop(start, "move", { x: 0.3, y: 0.3 }, { x: 0.9, y: 0.95 }, MIN)
  );
  assert.deepEqual([moved.w, moved.h], [0.3, 0.3], "same size");
  assert.ok(inside(moved));
  assert.ok(
    Math.abs(moved.x - 0.7) < 1e-9 && Math.abs(moved.y - 0.7) < 1e-9,
    "stopped at the edge",
  );
  // Pulling the left edge past the right one stops at the minimum width.
  const squeezed = /** @type {any} */ (
    dragCrop(start, "w", { x: 0.2, y: 0.3 }, { x: 0.9, y: 0.3 }, MIN)
  );
  assert.ok(Math.abs(squeezed.w - MIN.w) < 1e-9 && Math.abs(squeezed.x + squeezed.w - 0.5) < 1e-9);
  // A corner moves two edges, the opposite corner stays.
  const se = /** @type {any} */ (
    dragCrop(start, "se", { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.7 }, MIN)
  );
  assert.ok(
    Math.abs(se.w - 0.4) < 1e-9 && Math.abs(se.h - 0.5) < 1e-9 && se.x === 0.2 && se.y === 0.2,
  );
  for (const mode of /** @type {const} */ (["n", "s", "e", "w", "ne", "nw", "se", "sw", "move"])) {
    for (const to of [
      { x: -5, y: -5 },
      { x: 5, y: 5 },
      { x: 0.21, y: 0.79 },
    ]) {
      const c = /** @type {any} */ (dragCrop(start, mode, { x: 0.35, y: 0.35 }, to, MIN));
      assert.ok(inside(c), `${mode} ${JSON.stringify(to)}`);
      assert.ok(c.w >= MIN.w - 1e-9 && c.h >= MIN.h - 1e-9, `${mode} keeps its size`);
    }
  }
});

test("arrow keys move the rectangle, and with Shift resize it, within the picture", () => {
  const c = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  assert.deepEqual(nudge(c, "ArrowRight", false, MIN), { x: 0.11, y: 0.1, w: 0.2, h: 0.2 });
  assert.equal(nudge({ ...c, x: 0.8 }, "ArrowRight", false, MIN).x, 0.8, "already at the edge");
  assert.ok(Math.abs(nudge(c, "ArrowDown", true, MIN).h - 0.21) < 1e-9);
  let small = c;
  for (let i = 0; i < 50; i++) small = nudge(small, "ArrowLeft", true, MIN);
  assert.ok(Math.abs(small.w - MIN.w) < 1e-9, "no narrower than the minimum");
  let big = c;
  for (let i = 0; i < 200; i++) big = nudge(big, "ArrowRight", true, MIN);
  assert.ok(inside(big) && Math.abs(big.x + big.w - 1) < 1e-9, "no wider than the picture");
});
