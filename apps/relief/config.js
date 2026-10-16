/**
 * Shaded relief — settings and fixed data.
 */

/**
 * Mapzen's Terrain Tiles on AWS Open Data, in the "Terrarium" encoding: each
 * pixel's red, green and blue hold a height in metres. Free, no key, and
 * served to any site (the bucket sends `Access-Control-Allow-Origin: *`).
 */
export const TILE_HOST = "https://s3.amazonaws.com";
/** @param {number} z @param {number} x @param {number} y */
export const tileUrl = (z, x, y) =>
  `${TILE_HOST}/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Where the tiles' sources are credited, as their licences ask. */
export const ATTRIBUTION_URL = "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
export const CREDIT =
  "Elevation: Mapzen Terrain Tiles (SRTM, GMTED2010, ETOPO1, EU-DEM and others)";

/** Tiles exist from zoom 0 (the whole world) to 15; 14 is detailed enough. */
export const MAX_ZOOM = 14;
/** At most this many tiles per sheet; beyond it, a coarser zoom is used. */
export const MAX_TILES = 100;
/** Tiles kept in memory (each holds 256 × 256 heights, 256 KB). */
export const CACHE_TILES = 160;
/** A tile is a small PNG; anything bigger than this isn't one. */
export const MAX_TILE_BYTES = 2_000_000;
/** Give up on a tile after this long. */
export const TILE_TIMEOUT_MS = 20_000;
/** Tiles fetched at the same time. */
export const PARALLEL = 8;

/** The shading is computed on at most this many pixels, then scaled up. */
export const MAX_RELIEF_PIXELS = 9e6;

/**
 * The light: mostly the cartographers' classic one from the north-west,
 * softened by a second, higher one from the west so that slopes facing
 * away from the main light don't go black.
 */
export const LIGHTS = [
  { azimuth: 315, altitude: 45, weight: 0.75 },
  { azimuth: 270, altitude: 60, weight: 0.25 },
];

/**
 * How steep the steep slopes are drawn. Heights are exaggerated until the
 * steepest twentieth of the country's slopes reaches this angle, so flat
 * and mountainous countries both get readable relief.
 */
export const TARGET_SLOPE_DEG = 28;
/** The exaggeration stays within these bounds. */
export const MIN_EXAGGERATION = 1;
export const MAX_EXAGGERATION = 60;

/**
 * Colour by height: metres → colour. Each scheme spans the same heights, so
 * a lowland country stays low-coloured and the colours themselves are a
 * clue. The first is the default.
 *
 * @type {Array<{id: string, label: string, ramp: Array<[number, string]>}>}
 */
export const HEIGHT_SCHEMES = [
  {
    id: "atlas",
    label: "Atlas — green lowlands, brown mountains",
    ramp: [
      [0, "#9fbf8f"],
      [200, "#c3d39f"],
      [600, "#e0d7a6"],
      [1200, "#d2b88c"],
      [2200, "#b39a80"],
      [3500, "#cfc6bf"],
      [5000, "#f4f2f0"],
    ],
  },
  {
    id: "desert",
    label: "Desert — sand to rust",
    ramp: [
      [0, "#efe0bd"],
      [300, "#e3c48f"],
      [900, "#cf9a62"],
      [2000, "#a86e4a"],
      [3500, "#7c5847"],
      [5000, "#efe7df"],
    ],
  },
  {
    id: "alpine",
    label: "Alpine — cool greens to ice",
    ramp: [
      [0, "#cfe0d4"],
      [400, "#a9c4ad"],
      [1200, "#86a08c"],
      [2200, "#8a95a0"],
      [3200, "#c9d3dc"],
      [4500, "#ffffff"],
    ],
  },
  {
    id: "tropical",
    label: "Tropical — lush greens",
    ramp: [
      [0, "#7fb07a"],
      [300, "#9cc27a"],
      [900, "#c7c98a"],
      [1800, "#b49a73"],
      [3000, "#8f7b6b"],
      [4500, "#e9e4de"],
    ],
  },
  {
    id: "night",
    label: "Night — dark lowlands, pale peaks",
    ramp: [
      [0, "#23312e"],
      [300, "#2f4a3d"],
      [1000, "#56603f"],
      [2000, "#7d6a4a"],
      [3500, "#a89b8f"],
      [5000, "#efece8"],
    ],
  },
  {
    id: "grey",
    label: "Greyscale — dark low, light high",
    ramp: [
      [0, "#8a8a8a"],
      [5000, "#f5f5f5"],
    ],
  },
];

/** The heights the three colours of a custom scheme stand for. */
export const CUSTOM_HEIGHTS = [0, 1000, 3500];
