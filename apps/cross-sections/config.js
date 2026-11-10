/**
 * Cross-sections — settings.
 */

/**
 * The shared height scale runs from sea level to this many metres, so
 * countries can be compared: a flat country looks flat. A line over higher
 * ground raises it to the next thousand.
 */
export const SHARED_TOP_M = 6000;

/** Points read along the line, about one per two pixels of a wide sheet. */
export const SAMPLES = 900;

/** At most this many tiles for one line; beyond it, coarser tiles are read. */
export const MAX_LINE_TILES = 48;

/**
 * The search for a country's highest ground reads a grid of about this
 * many columns, from tiles coarse enough to need at most this many.
 */
export const GRID_COLUMNS = 90;
export const MAX_GRID_TILES = 40;
/** The grid search stops at this zoom: finer tiles wouldn't change the answer much. */
export const MAX_GRID_ZOOM = 10;
