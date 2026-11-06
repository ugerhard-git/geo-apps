/**
 * Climate — presets: examples to start from, and how a look colours
 * the chart. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "india",
    name: "India — the monsoon",
    look: "classic",
    country: "IN",
  },
  {
    id: "russia",
    name: "Russia — long, cold winters",
    look: "sea",
    country: "RU",
  },
  {
    id: "egypt",
    name: "Egypt — hot and dry, with figures",
    look: "sand",
    country: "EG",
    set: { optValues: true },
  },
  {
    id: "iceland",
    name: "Iceland — cool all year",
    look: "alpine",
    country: "IS",
  },
  {
    id: "singapore",
    name: "Singapore — hot and wet all year",
    look: "forest",
    country: "SG",
  },
];

/**
 * The colour controls of the chart for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { tempColor: look.accent, rainColor: look.second, inkColor: look.ink, bgColor: look.paper },
});
