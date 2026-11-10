/**
 * Place-name endings — settings.
 */

/**
 * Countries with fewer distinct place names than this aren't offered: too
 * few for the endings to mean much (Kenya and Chile have about 110–140 in
 * GeoNames' list).
 */
export const MIN_PLACES = 150;

/** Fewer typical endings than this, and the sheet says the country has few. */
export const MIN_ENDINGS = 6;

/** "Twelve towns": how many, and which places they're picked from. */
export const TOWN_COUNT = 12;
export const TOWN_MIN_POP = 3000;
/** The largest cities are left out by default: a capital would give the answer away. */
export const SKIP_LARGEST = 10;

/** Credit line GeoNames' licence asks for. */
export const CREDIT = "Place names: GeoNames, CC BY 4.0";
