/**
 * City dots — settings and fixed data.
 */

/**
 * Every place in GeoNames with at least 1000 inhabitants, packed by the
 * all-the-cities package (MIT; data from GeoNames, CC BY 4.0). A pinned
 * version, so the file can't change under the page.
 */
export const CITIES_URL = "https://cdn.jsdelivr.net/npm/all-the-cities@3.1.0/cities.pbf";

/** The file is about 6.4 MB; anything far bigger is not the file we expect. */
export const MAX_BYTES = 24 * 1024 * 1024;

/** It holds about 138,000 records. */
export const MAX_RECORDS = 400_000;

/*
  GeoNames feature codes that are not towns in their own right: parts of a
  city (PPLX), and places that are historical, abandoned or destroyed. A city
  and its districts would otherwise show up as a cluster of dots.
*/
export const SKIP_FEATURES = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);

/** How many cities can be drawn, and the default. */
export const COUNT_MIN = 5;
export const COUNT_MAX = 300;
export const COUNT_DEFAULT = 40;

/*
  A city counts as part of the mainland when it lies within this many
  degrees of one of the mainland's landmasses (its bounding box). Coastal
  towns sit just outside a 1:50m coastline, and a small island town near the
  coast belongs with it.
*/
export const MAINLAND_SLACK_DEG = 0.35;
