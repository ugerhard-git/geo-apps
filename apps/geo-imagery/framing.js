/**
 * Geo imagery — framing: the box around a subject, and turning it into a box
 * in the projection's plane, with antimeridian handling.
 */

import { clamp, own } from "../../shared/util.js";
import { MAINLAND_OVERRIDE } from "../../shared/geo.js";
import { mainlandSet } from "./countries.js";
import { project, worldHalf, yLimitFor } from "./projections.js";

/* ═══════════════════════════════════════════════════════════
   Bounding box, with antimeridian handling
   ═══════════════════════════════════════════════════════════ */

export function bboxFor(country, mainlandOnly) {
  const ov = mainlandOnly ? own(MAINLAND_OVERRIDE, country.name) : undefined;
  if (ov) return { lon0: ov.lon[0], lon1: ov.lon[1], lat0: ov.lat[0], lat1: ov.lat[1] };

  const keep = mainlandOnly ? mainlandSet(country) : null;
  const use = country.polys.filter((p, i) => !keep || keep.has(i));
  const lons = [],
    lats = [];
  for (const p of use)
    for (const ring of p.rings)
      for (const [x, y] of ring) {
        lons.push(x);
        lats.push(y);
      }

  // Iterate rather than spreading into Math.min: Russia alone carries tens of
  // thousands of vertices at 50 m, which overflows the argument limit.
  let lo = Infinity,
    hi = -Infinity,
    loW = Infinity,
    hiW = -Infinity;
  for (const l of lons) {
    if (l < lo) lo = l;
    if (l > hi) hi = l;
    const w = l < 0 ? l + 360 : l;
    if (w < loW) loW = w;
    if (w > hiW) hiW = w;
  }
  let latLo = Infinity,
    latHi = -Infinity;
  for (const l of lats) {
    if (l < latLo) latLo = l;
    if (l > latHi) latHi = l;
  }
  const span = hi - lo <= hiW - loW ? [lo, hi] : [loW, hiW];
  return { lon0: span[0], lon1: span[1], lat0: latLo, lat1: latHi };
}

/* Turn a geographic box into a framed, nudged box in the working plane. */
export function planeBox(bb, crs, padPct, offX, offY) {
  const wrapsDateline = bb.lon1 > 180;
  const half = worldHalf(crs);

  /*
    In Equal Earth the meridians curve, so the widest part of a latitude band
    is the row nearest the equator. Measuring x there — rather than at a corner —
    gives the true extent without sampling the whole outline.
  */
  const xAtLat =
    crs === "eqearth"
      ? bb.lat0 <= 0 && bb.lat1 >= 0
        ? 0
        : Math.abs(bb.lat0) < Math.abs(bb.lat1)
          ? bb.lat0
          : bb.lat1
      : 0;

  let x0 = project(bb.lon0, xAtLat, crs)[0];
  let x1 = wrapsDateline
    ? project(bb.lon1 - 360, xAtLat, crs)[0] + 2 * half
    : project(bb.lon1, xAtLat, crs)[0];
  let y0 = project(0, bb.lat0, crs)[1];
  let y1 = project(0, bb.lat1, crs)[1];

  /*
    A multiplier on the subject's extent rather than a margin: 1 frames it
    exactly, below 1 crops into it, above 1 pulls back. Nudges are fractions
    of the framed half-extent, so a nudge covers less ground the tighter the
    framing — which is how moving around a zoomed picture should feel.
  */
  const factor = Math.max(0.05, (Number.isFinite(padPct) ? padPct : 100) / 100);
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const halfW = ((x1 - x0) / 2) * factor,
    halfH = ((y1 - y0) / 2) * factor;
  const nx = clamp(Number.isFinite(offX) ? offX : 0, -1, 1);
  const ny = clamp(Number.isFinite(offY) ? offY : 0, -1, 1);

  x0 = cx + nx * halfW - halfW;
  x1 = cx + nx * halfW + halfW;
  y0 = cy + ny * halfH - halfH;
  y1 = cy + ny * halfH + halfH;

  const yLimit = yLimitFor(crs);
  // Clamp without collapsing the box: shift it back inside, then trim.
  if (y1 - y0 > 2 * yLimit) {
    y0 = -yLimit;
    y1 = yLimit;
  } else if (y1 > yLimit) {
    const d = y1 - yLimit;
    y0 -= d;
    y1 -= d;
  } else if (y0 < -yLimit) {
    const d = -yLimit - y0;
    y0 += d;
    y1 += d;
  }
  y0 = clamp(y0, -yLimit, yLimit);
  y1 = clamp(y1, -yLimit, yLimit);
  if (x1 - x0 > 2 * half) {
    x0 = -half;
    x1 = half;
  }
  // Keep the left edge inside the world; planRequests splits anything that
  // now runs off the right edge.
  if (x0 < -half) {
    x0 += 2 * half;
    x1 += 2 * half;
  }

  return { x0, x1, y0, y1 };
}
