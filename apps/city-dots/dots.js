/**
 * City dots — which cities to draw, and where.
 *
 * Everything happens in Web Mercator plane coordinates, the same projection
 * the Outlines app uses, so a country's dots and its outline line up.
 *
 * Pure — no DOM — so it can be unit-tested.
 */

import { boundsOf, mercator, projectSubject } from "../../shared/projection.js";

/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("./cities.js").City} City */
/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Box */

/**
 * @typedef {object} Dot
 * @property {number} x plane coordinates
 * @property {number} y
 * @property {number} pop
 * @property {boolean} capital
 */

/**
 * The country's landmasses in the plane, and a box around each, which is
 * what decides whether a city belongs to the part being drawn.
 *
 * @param {Polys | null} polys in degrees, or null when there is no outline
 * @param {boolean} mainOnly
 * @param {string} name the country's Natural Earth name (for mainland rules)
 * @returns {{shape: Polys, boxes: Box[]}}
 */
export function subject(polys, mainOnly, name) {
  if (!polys) return { shape: [], boxes: [] };
  let shape = projectSubject(polys, mainOnly, name);
  /*
    A country whose islands lie on both sides of the antimeridian (Fiji,
    Kiribati, Russia's far east) would stretch across the whole world:
    its western islands are moved round to join the rest.
  */
  const whole = boundsOf(shape);
  if (whole && whole.x1 - whole.x0 > Math.PI)
    shape = shape.map((rings) => {
      const b = boundsOf([rings]);
      return b && b.x1 < 0
        ? rings.map((ring) =>
            ring.map(([x, y]) => /** @type {[number, number]} */ ([x + 2 * Math.PI, y])),
          )
        : rings;
    });
  /** @type {Box[]} */
  const boxes = [];
  for (const rings of shape) {
    const b = boundsOf([rings]);
    if (b) boxes.push(b);
  }
  return { shape, boxes };
}

/**
 * The largest `count` cities that lie within reach of the subject.
 *
 * A city just east of the antimeridian is tried shifted by 360°, the way
 * {@link projectSubject} shifts the outline, so Chukotka's towns stay with
 * Russia's outline rather than landing on the far side of the world.
 *
 * @param {City[]} cities largest first
 * @param {number} count
 * @param {Box[]} boxes from {@link subject}; empty means "no outline, keep all"
 * @param {number} slackDeg how far outside a box a city may lie
 * @param {boolean} [withCapital] include the capital even when it is not among the largest
 * @returns {Dot[]} largest first
 */
export function pickDots(cities, count, boxes, slackDeg, withCapital = false) {
  const slack = (slackDeg * Math.PI) / 180;
  /** @param {number} x @param {number} y */
  const inside = (x, y) =>
    boxes.some(
      (b) => x >= b.x0 - slack && x <= b.x1 + slack && y >= b.y0 - slack && y <= b.y1 + slack,
    );
  /**
   * @param {City} c
   * @returns {Dot | null} null when the city lies outside the subject
   */
  const place = (c) => {
    let [x, y] = mercator(c.lon, c.lat);
    if (boxes.length && !inside(x, y)) {
      const shifted = c.lon < 0 ? mercator(c.lon + 360, c.lat) : null;
      if (!shifted || !inside(shifted[0], shifted[1])) return null;
      [x, y] = shifted;
    }
    return { x, y, pop: c.pop, capital: c.capital };
  };
  /** @type {Dot[]} */
  const out = [];
  let i = 0;
  for (; i < cities.length && out.length < count; i++) {
    const d = place(cities[i]);
    if (d) out.push(d);
  }
  if (withCapital && count > 0 && !out.some((d) => d.capital)) {
    for (; i < cities.length; i++) {
      if (!cities[i].capital) continue;
      const d = place(cities[i]);
      if (!d) continue;
      if (out.length >= count) out.pop(); // the capital takes the smallest one's place
      out.push(d);
      break;
    }
  }
  return out;
}

/**
 * The area the sheet has to show: the outline, and every dot.
 *
 * @param {Box[]} boxes
 * @param {Dot[]} dots
 * @returns {Box | null}
 */
export function extentOf(boxes, dots) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  for (const d of dots) {
    x0 = Math.min(x0, d.x);
    y0 = Math.min(y0, d.y);
    x1 = Math.max(x1, d.x);
    y1 = Math.max(y1, d.y);
  }
  if (!Number.isFinite(x0)) return null;
  // A single city, or a row of them, still needs an area to sit in.
  const minSpan = 0.01;
  if (x1 - x0 < minSpan) [x0, x1] = [(x0 + x1) / 2 - minSpan / 2, (x0 + x1) / 2 + minSpan / 2];
  if (y1 - y0 < minSpan) [y0, y1] = [(y0 + y1) / 2 - minSpan / 2, (y0 + y1) / 2 + minSpan / 2];
  return { x0, y0, x1, y1 };
}

/**
 * Dot radius for a population: the dot's area grows with the population, as
 * on a proportional-symbol map, with a floor so small towns stay visible.
 *
 * @param {number} pop
 * @param {number} maxPop the largest population on the sheet
 * @param {number} rMax radius of the largest dot
 * @param {boolean} equal all dots the same size
 */
export function radiusFor(pop, maxPop, rMax, equal) {
  const rMin = Math.max(1.5, rMax * 0.14);
  if (equal) return Math.max(rMin, rMax * 0.45);
  if (!(maxPop > 0) || !(pop > 0)) return rMin;
  return Math.max(rMin, rMax * Math.sqrt(Math.min(pop, maxPop) / maxPop));
}
