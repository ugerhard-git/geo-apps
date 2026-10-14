/**
 * Outlines — settings and fixed data.
 */

/** Natural Earth 1:50m country outlines, as TopoJSON. */
export { WORLD_ATLAS_URL as TOPO_URL } from "../../shared/world.js";

/*
  Natural Earth's 1:50m admin-1 file covers only 34 large federal countries —
  Germany and Kenya are simply not in it — and its 1:10m edition runs to some
  57 MB. geoBoundaries publishes one small file per country instead, covering
  the world, so only the country being drawn is ever fetched.
*/

/** @param {string} iso3 */
const GEOB_PATH = (iso3) =>
  `wmgeolab/geoBoundaries/main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`;

/**
 * Where to look for a country's region file, in order.
 *
 * geoBoundaries keeps its GeoJSON in Git LFS. Both jsDelivr and GitHub's raw
 * endpoint hand back the pointer file, because that is genuinely what the
 * repository holds; only the media endpoint resolves the pointer to the data.
 *
 * @type {Array<(iso3: string) => string>}
 */
export const REGION_HOSTS = [
  (iso3) => `https://media.githubusercontent.com/media/${GEOB_PATH(iso3)}`,
  (iso3) => `https://raw.githubusercontent.com/${GEOB_PATH(iso3)}`,
  (iso3) =>
    `https://cdn.jsdelivr.net/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`,
];

/**
 * Where geoBoundaries itself says the file is, if the direct addresses fail.
 *
 * @param {string} iso3
 */
export const GEOB_API = (iso3) => `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`;

/* A download address from a response is only followed if it leads somewhere
   this page is already allowed to reach. */
export const ALLOWED_DATA_HOSTS = new Set([
  "media.githubusercontent.com",
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
]);

/** Names people type that the geometry files do not use, by Natural Earth name. */
export const ALIASES = {
  "United States of America": ["usa", "us", "united states", "america"],
  "United Kingdom": ["uk", "great britain", "britain", "england"],
  Russia: ["russian federation"],
  Czechia: ["czech republic"],
  Myanmar: ["burma"],
  Netherlands: ["holland"],
  Germany: ["deutschland", "brd"],
  Switzerland: ["schweiz", "suisse"],
  Austria: ["osterreich", "oesterreich"],
  "Côte d'Ivoire": ["ivory coast", "cote divoire"],
  Eswatini: ["swaziland"],
  Türkiye: ["turkey"],
  "Cabo Verde": ["cape verde"],
  "Timor-Leste": ["east timor"],
  "Dem. Rep. Congo": ["drc", "democratic republic of the congo", "congo kinshasa"],
  Congo: ["republic of the congo", "congo brazzaville"],
};
