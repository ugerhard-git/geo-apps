/**
 * Flag colours — presets: examples to start from, and how a look colours
 * the chart. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "southafrica",
    name: "South Africa — six colours",
    look: "classic",
    country: "ZA",
  },
  {
    id: "brazil",
    name: "Brazil — green, yellow and blue",
    look: "forest",
    country: "BR",
  },
  {
    id: "japan",
    name: "Japan — mostly white",
    look: "sand",
    country: "JP",
  },
  {
    id: "bhutan",
    name: "Bhutan — drawn as a ring",
    look: "sand",
    country: "BT",
    set: { optRing: true },
  },
  {
    id: "srilanka",
    name: "Sri Lanka — with colour codes",
    look: "night",
    country: "LK",
    set: { optHex: true },
  },
];

/**
 * The colour controls of the chart for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({ set: { fgColor: look.ink, bgColor: look.paper } });
