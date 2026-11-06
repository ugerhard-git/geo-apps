/**
 * GeoCards — presets: examples to start from, and how a look colours
 * the cards. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "mongolia",
    name: "Mongolia",
    look: "classic",
    country: "MN",
  },
  {
    id: "brazil",
    name: "Brazil",
    look: "forest",
    country: "BR",
  },
  {
    id: "iceland",
    name: "Iceland",
    look: "night",
    country: "IS",
  },
  {
    id: "egypt",
    name: "Egypt",
    look: "sand",
    country: "EG",
  },
  {
    id: "japan",
    name: "Japan",
    look: "sea",
    country: "JP",
  },
];

/**
 * The colour controls of the cards for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { sheetBg: look.paper, cardBg: look.ink, cardText: look.paper },
});
