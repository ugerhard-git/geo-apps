/**
 * The country list for the map apps (City dots, Rivers): CLDR names in the
 * picker, each matched to its world-atlas outline.
 *
 * @module shared/map-countries
 */

import { loadNumeric, loadTerritories } from "./cldr.js";
import { bareName } from "./text.js";
import { WORLD_ATLAS_URL, topoCountries } from "./world.js";

/** @typedef {import("./cldr.js").Territory} Territory */
/** @typedef {import("./world.js").CountryShape} CountryShape */

/** Names people type that CLDR doesn't list, by ISO code. */
export const ALIASES = {
  US: ["usa", "america"],
  GB: ["uk", "great britain", "britain", "england"],
  NL: ["holland"],
  DE: ["deutschland"],
  CH: ["schweiz", "suisse"],
  AT: ["osterreich", "oesterreich"],
  CI: ["ivory coast"],
  SZ: ["swaziland"],
  TR: ["turkey"],
  CV: ["cape verde"],
  TL: ["east timor"],
  CD: ["drc", "congo kinshasa"],
  CG: ["congo brazzaville"],
  MM: ["burma"],
};

/**
 * @typedef {object} MapCountries
 * @property {Territory[]} territories for the picker
 * @property {(t: Territory) => CountryShape | null} shapeFor the outline of a country, if there is one
 * @property {boolean} outlinesFailed the outlines couldn't be loaded (the list still works)
 */

/**
 * Load the country names, the code table and the outlines together.
 * Only the names are essential: without outlines, `shapeFor` returns null.
 *
 * @returns {Promise<MapCountries>}
 * @throws when the country names can't be loaded
 */
export async function loadMapCountries() {
  let outlinesFailed = false;
  const outlines = fetch(WORLD_ATLAS_URL)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(topoCountries)
    .catch(() => {
      outlinesFailed = true;
      return /** @type {CountryShape[]} */ ([]);
    });
  const [territories, numeric, shapes] = await Promise.all([
    loadTerritories(),
    loadNumeric().catch(() => /** @type {Map<string, string>} */ (new Map())),
    outlines,
  ]);
  return {
    territories,
    shapeFor: (t) => matchShape(t, numeric, shapes),
    outlinesFailed: outlinesFailed || !shapes.length,
  };
}

/**
 * The outline for a country: by ISO numeric code, which is how world-atlas
 * identifies its shapes, or by name for the few it leaves without a code
 * (Kosovo, for one).
 *
 * @param {Territory} t
 * @param {Map<string, string>} numeric alpha-2 → ISO numeric
 * @param {CountryShape[]} shapes
 * @returns {CountryShape | null}
 */
export function matchShape(t, numeric, shapes) {
  const names = new Set([t.name, ...t.alts].map(bareName));
  const byName = (/** @type {CountryShape} */ s) => names.has(bareName(s.name));
  const num = numeric.get(t.code);
  const byId = num ? shapes.filter((s) => s.id === num) : [];
  /*
    A code can be shared: Australia's also marks the Ashmore and Cartier
    Islands. Then the shape with the country's name wins, or else the one
    with the most outline.
  */
  if (byId.length > 1)
    return byId.find(byName) || byId.reduce((a, b) => (pointCount(b) > pointCount(a) ? b : a));
  return byId[0] || shapes.find(byName) || null;
}

/** @param {CountryShape} s */
const pointCount = (s) =>
  s.polys.reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);
