/**
 * Subdivision clouds — settings and fixed data.
 */

/** Colour schemes for the cloud, offered in the "Palette" menu. */
export const PALETTES = [
  {
    id: "okabe",
    name: "Okabe–Ito (colour-blind safe)",
    colours: [
      "#0072b2",
      "#e69f00",
      "#009e73",
      "#cc79a7",
      "#56b4e9",
      "#d55e00",
      "#8a6d3b",
      "#4d4d4d",
    ],
  },
  {
    id: "earth",
    name: "Muted earth",
    colours: [
      "#7a6a53",
      "#a8894c",
      "#5f7a6a",
      "#9c5f4e",
      "#7c7f93",
      "#b09a6b",
      "#4f5d63",
      "#8d8378",
    ],
  },
  {
    id: "bright",
    name: "High contrast",
    colours: [
      "#c62828",
      "#2e7d32",
      "#ef6c00",
      "#1565c0",
      "#6a1b9a",
      "#00838f",
      "#ad1457",
      "#4e342e",
    ],
  },
  {
    id: "mono",
    name: "Single hue (prints grey)",
    colours: [
      "#12333a",
      "#1d4b54",
      "#2a656f",
      "#3c808a",
      "#5a9aa2",
      "#7fb4ba",
      "#a8cdd1",
      "#cde3e5",
    ],
  },
];

/**
 * Area on Wikidata carries whatever unit the editor used, so the raw number
 * means nothing on its own. These are converted to square kilometres. A value
 * in a unit not listed here counts as no value at all, which — since a measure
 * is only offered when every division has one — withdraws area for that
 * country rather than showing one region under the wrong unit.
 */
export const AREA_UNITS = {
  Q712226: 1, // square kilometre
  Q25343: 1e-6, // square metre
  Q232291: 2.589988, // square mile
  Q35852: 0.01, // hectare
  Q2737347: 0.0001, // are
  Q81292: 0.00404686, // acre
};
export const AREA_UNIT_NAME = "square kilometres";
