/**
 * Day length — settings.
 */

/** The capitals' positions and time zones (built by scripts/day-length/build-data.mjs). */
export const DATA_URL = "data/capitals.json";
/** The file is about 25 KB; anything far bigger is not the file we expect. */
export const MAX_DATA_BYTES = 500_000;

/** Credit line GeoNames' licence asks for. */
export const CREDIT = "Capitals and time zones: GeoNames, CC BY 4.0";
