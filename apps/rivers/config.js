/**
 * Rivers — settings and fixed data.
 */

/** Natural Earth's GeoJSON files, at a fixed release so they can't change under the page. */
const NE = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/";

/** The world's rivers and lake centre-lines at 1:10m (about 7 MB). */
export const RIVERS_URL = NE + "ne_10m_rivers_lake_centerlines.geojson";

/** Lakes and reservoirs at 1:10m (about 5 MB), fetched only when lakes are drawn. */
export const LAKES_URL = NE + "ne_10m_lakes.geojson";

/**
 * Natural Earth adds smaller rivers for three regions. Each file is fetched
 * only for a country that overlaps its area (in degrees).
 *
 * @type {Array<{id: string, url: string, box: {w: number, s: number, e: number, n: number}}>}
 */
export const REGIONAL = [
  {
    id: "europe",
    url: NE + "ne_10m_rivers_europe.geojson",
    box: { w: -21.6, s: 27.3, e: 65.9, n: 70.1 },
  },
  {
    id: "north_america",
    url: NE + "ne_10m_rivers_north_america.geojson",
    box: { w: -166.4, s: 7.8, e: -53.9, n: 82.7 },
  },
  {
    id: "australia",
    url: NE + "ne_10m_rivers_australia.geojson",
    box: { w: 113.6, s: -42.9, e: 153.4, n: -12.0 },
  },
];

/** The largest of these files is under 9 MB; anything far bigger is refused. */
export const MAX_BYTES = 24 * 1024 * 1024;

/** Limits on what one file may contain, well above the real counts. */
export const MAX_FEATURES = 20_000;
export const MAX_POINTS = 1_500_000;

/*
  Rivers are kept up to this far outside the border, so a river that forms
  the border (the Rhine between France and Germany) is drawn for both
  countries even though the 1:10m river and the 1:50m border don't line up
  exactly.
*/
export const BORDER_KM = 6;

/*
  A stretch of river that never enters the country, only runs close to it,
  is kept only when it is at least this long: long enough to be a border
  river, rather than a neighbour's river brushing past.
*/
export const BORDER_RUN_KM = 25;
