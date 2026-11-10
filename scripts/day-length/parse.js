/**
 * Day length — reading GeoNames' place list for the capitals: each
 * country's national capital (feature code PPLC) with its position and time
 * zone. Pure, so it can be tested without the network. The app reads the
 * result with the same checks (apps/day-length/capitals.js).
 */

import { knownTimeZone } from "../../apps/day-length/capitals.js";

/** @typedef {import("../../apps/day-length/capitals.js").Capital} Capital */

/**
 * The capitals in a GeoNames dump (`cities1000.txt`: tab-separated, one place
 * per line). Where a country has more than one place marked as its capital,
 * the most populous wins.
 *
 * Columns used: 1 name, 4 latitude, 5 longitude, 7 feature code, 8 country
 * code, 14 population, 17 time zone.
 *
 * @param {string} tsv
 * @returns {Record<string, Capital>} by ISO alpha-2 code, sorted
 */
export function parseCapitals(tsv) {
  /** @type {Map<string, Capital & {pop: number}>} */
  const best = new Map();
  for (const line of tsv.split("\n")) {
    const f = line.split("\t");
    if (f.length < 18 || f[7] !== "PPLC") continue;
    const cc = f[8];
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    const pop = Number(f[14]) || 0;
    const tz = f[17];
    const name = f[1].trim().slice(0, 80);
    if (!/^[A-Z]{2}$/.test(cc) || !name) continue;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || !knownTimeZone(tz)) continue;
    const had = best.get(cc);
    if (!had || pop > had.pop) best.set(cc, { name, lat, lon, tz, pop });
  }
  /** @type {Record<string, Capital>} */
  const out = {};
  for (const cc of [...best.keys()].sort()) {
    const { name, lat, lon, tz } = /** @type {Capital & {pop: number}} */ (best.get(cc));
    out[cc] = { name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, tz };
  }
  return out;
}
