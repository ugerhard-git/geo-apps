/**
 * Subdivisions — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "australia",
    name: "Australia — states and territories",
    look: "classic",
    country: "AU",
  },
  {
    id: "usa",
    name: "United States — 50 states",
    look: "sea",
    country: "US",
  },
  {
    id: "france",
    name: "France — regions",
    look: "rose",
    country: "FR",
  },
  {
    id: "nigeria",
    name: "Nigeria — 36 states",
    look: "forest",
    country: "NG",
  },
  {
    id: "india",
    name: "India — states and territories",
    look: "sand",
    country: "IN",
  },
];

/**
 * The colour controls of the sheet for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { fgColor: look.ink, bgColor: look.paper, palette: look.chart },
});
