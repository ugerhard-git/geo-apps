/**
 * Geo imagery — map projections: Web Mercator (EPSG:3857), plate carrée
 * (EPSG:4326) and Equal Earth, which is reprojected here because GIBS does
 * not serve it.
 */

import { clamp } from "../../shared/util.js";

/* ═══════════════════════════════════════════════════════════
   Small helpers
   ═══════════════════════════════════════════════════════════ */

export const R_EARTH = 6378137;
export const MAX_MERC_LAT = 85.05112878;
export const MERC_MAX = Math.PI * R_EARTH; // 20037508.34

export const merX = (lon) => (R_EARTH * lon * Math.PI) / 180;
export const merY = (lat) =>
  R_EARTH *
  Math.log(Math.tan(Math.PI / 4 + (clamp(lat, -MAX_MERC_LAT, MAX_MERC_LAT) * Math.PI) / 360));

/*
  Equal Earth (Šavrič, Patterson & Jenny, 2018) — an equal-area pseudocylindrical
  projection. GIBS doesn't serve it, so imagery is fetched in EPSG:4326 and
  reprojected here. Being pseudocylindrical, latitude depends only on y, which
  makes the reprojection one horizontal stretch per output row.
*/
export const EE_A1 = 1.340264,
  EE_A2 = -0.081106,
  EE_A3 = 0.000893,
  EE_A4 = 0.003796;
export const SQ3_2 = Math.sqrt(3) / 2;

/* dy/dθ — also the factor relating longitude to x within a row. */
export function eeDeriv(th) {
  const t2 = th * th,
    t6 = t2 * t2 * t2;
  return EE_A1 + 3 * EE_A2 * t2 + t6 * (7 * EE_A3 + 9 * EE_A4 * t2);
}
export function eeYofTheta(th) {
  const t2 = th * th,
    t6 = t2 * t2 * t2;
  return th * (EE_A1 + EE_A2 * t2 + t6 * (EE_A3 + EE_A4 * t2));
}
/* Parametric latitude θ from a projected y (Newton; converges in a few steps). */
export function eeTheta(y) {
  let th = y;
  for (let i = 0; i < 20; i++) {
    const d = (eeYofTheta(th) - y) / eeDeriv(th);
    th -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return th;
}
export function eeX(lonDeg, latDeg) {
  const th = Math.asin(SQ3_2 * Math.sin((latDeg * Math.PI) / 180));
  return (R_EARTH * ((lonDeg * Math.PI) / 180) * Math.cos(th)) / (SQ3_2 * eeDeriv(th));
}
export function eeY(latDeg) {
  return R_EARTH * eeYofTheta(Math.asin(SQ3_2 * Math.sin((latDeg * Math.PI) / 180)));
}
/* Latitude, in degrees, at a given projected y. */
export function eeLatOf(y) {
  const s = Math.sin(eeTheta(y / R_EARTH)) / SQ3_2;
  return Math.abs(s) > 1 ? null : (Math.asin(s) * 180) / Math.PI;
}
/* Degrees of longitude per unit x, on the row at parametric latitude θ. */
export function eeLonPerX(th) {
  return (((SQ3_2 * eeDeriv(th)) / Math.cos(th)) * 180) / Math.PI / R_EARTH;
}

export const EE_X_HALF = eeX(180, 0);
export const EE_Y_POLE = eeY(90);

/* Project a lon/lat pair into the working plane for the chosen CRS. */
export function project(lon, lat, crs) {
  if (crs === "3857") return [merX(lon), merY(lat)];
  if (crs === "eqearth") return [eeX(lon, lat), eeY(lat)];
  return [lon, lat];
}
/* Horizontal extent of the world in the working plane, used for dateline splits. */
export const worldHalf = (crs) => (crs === "3857" ? MERC_MAX : crs === "eqearth" ? EE_X_HALF : 180);

/* Vertical limit of the working plane. */
export const yLimitFor = (crs) =>
  crs === "3857" ? merY(MAX_MERC_LAT) : crs === "eqearth" ? EE_Y_POLE : 90;
