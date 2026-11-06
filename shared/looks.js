/**
 * Looks: matched colour schemes the apps share, for their presets and the
 * "Random look" button.
 *
 * A look is a paper colour, an ink colour for text and an accent, plus a hint
 * for apps with colour lists of their own (the relief's height colours, the
 * statistics' chart palette). Each app turns a look into its own controls;
 * see `lookToControls` in the app's presets.js.
 *
 * Every look keeps text readable: the unit tests check that ink on paper has a
 * contrast of at least 7 : 1 (WCAG AAA), and the accent at least 3 : 1.
 *
 * @module shared/looks
 */

/**
 * @typedef {object} Look
 * @property {string} id
 * @property {string} name shown in the preset list
 * @property {string} paper the sheet's background
 * @property {string} ink text
 * @property {string} accent highlights: bars, a second text colour
 * @property {string} second a second highlight, set apart from the accent
 *   (rain next to temperature, water next to land)
 * @property {string} relief the Relief app's height colours (a scheme id)
 * @property {string} chart the Country statistics app's palette (an id)
 */

/** @type {Look[]} */
export const LOOKS = [
  {
    id: "classic",
    name: "Classic paper",
    paper: "#f6f2ea",
    ink: "#23262d",
    accent: "#b4553a",
    second: "#2f6f8f",
    relief: "atlas",
    chart: "okabe",
  },
  {
    id: "night",
    name: "Night",
    paper: "#14161c",
    ink: "#e8eaf0",
    accent: "#e2865c",
    second: "#7fb8e6",
    relief: "night",
    chart: "bright",
  },
  {
    id: "print",
    name: "Black and white",
    paper: "#ffffff",
    ink: "#000000",
    accent: "#555555",
    second: "#767676",
    relief: "grey",
    chart: "mono",
  },
  {
    id: "sea",
    name: "Sea blue",
    paper: "#eaf2f6",
    ink: "#12324a",
    accent: "#2a6f9e",
    second: "#b4553a",
    relief: "atlas",
    chart: "okabe",
  },
  {
    id: "forest",
    name: "Forest",
    paper: "#eef2e8",
    ink: "#1f3324",
    accent: "#4f7d3a",
    second: "#2f6f8f",
    relief: "tropical",
    chart: "earth",
  },
  {
    id: "sand",
    name: "Desert sand",
    paper: "#f4ead8",
    ink: "#3b2a1a",
    accent: "#b0581f",
    second: "#2f6f8f",
    relief: "desert",
    chart: "earth",
  },
  {
    id: "alpine",
    name: "Alpine",
    paper: "#f3f5f7",
    ink: "#1d2733",
    accent: "#6a4f8f",
    second: "#2e7d6b",
    relief: "alpine",
    chart: "okabe",
  },
  {
    id: "poster",
    name: "Bold poster",
    paper: "#1b2a6b",
    ink: "#ffd23f",
    accent: "#ff7a7f",
    second: "#7fe0c4",
    relief: "night",
    chart: "bright",
  },
  {
    id: "chalk",
    name: "Chalkboard",
    paper: "#22302a",
    ink: "#f1efe6",
    accent: "#e7c66b",
    second: "#8fc7e8",
    relief: "night",
    chart: "bright",
  },
  {
    id: "rose",
    name: "Rose",
    paper: "#fbeef0",
    ink: "#3d1f2b",
    accent: "#b8325a",
    second: "#2f6f8f",
    relief: "desert",
    chart: "earth",
  },
];

/**
 * The look with this id.
 *
 * @param {string} id
 * @returns {Look | undefined}
 */
export const lookById = (id) => LOOKS.find((l) => l.id === id);

/**
 * A colour part of the way from `a` to `b`: 0 is `a`, 1 is `b`. For tints such
 * as a key a shade off the paper.
 *
 * @param {string} a "#rrggbb"
 * @param {string} b "#rrggbb"
 * @param {number} t
 */
export function mix(a, b, t) {
  /** @param {string} hex @param {number} i */
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * WCAG contrast ratio between two colours, 1 to 21.
 *
 * @param {string} a "#rrggbb"
 * @param {string} b "#rrggbb"
 */
export function contrast(a, b) {
  /** @param {string} hex */
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
