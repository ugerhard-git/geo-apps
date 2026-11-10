/**
 * Day length — reading the capitals file (data/capitals.json): each
 * country's capital, with its position and time zone. Built from GeoNames by
 * scripts/day-length/build-data.mjs, which uses the same checks.
 *
 * The file is checked again here: an entry with an impossible position or a
 * time zone the browser doesn't know is left out, not drawn wrongly.
 */

/**
 * @typedef {object} Capital
 * @property {string} name as GeoNames writes it
 * @property {number} lat degrees
 * @property {number} lon degrees
 * @property {string} tz IANA time zone, e.g. "Europe/Madrid"
 */

/**
 * Whether the JavaScript runtime knows this time zone. The clock times are
 * worked out from it, so an unknown one would be useless.
 *
 * @param {unknown} tz
 */
export function knownTimeZone(tz) {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The capitals from the file, by ISO alpha-2 code.
 *
 * @param {any} data the parsed file
 * @returns {Map<string, Capital>}
 */
export function parseCapitalsFile(data) {
  /** @type {Map<string, Capital>} */
  const out = new Map();
  const all = data && typeof data === "object" ? data.capitals : null;
  if (!all || typeof all !== "object") return out;
  for (const [cc, c] of Object.entries(all)) {
    if (!/^[A-Z]{2}$/.test(cc) || !c || typeof c !== "object") continue;
    const { name, lat, lon, tz } = /** @type {any} */ (c);
    if (typeof name !== "string" || !name.trim()) continue;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || !knownTimeZone(tz)) continue;
    out.set(cc, { name: name.trim().slice(0, 80), lat, lon, tz });
  }
  return out;
}
