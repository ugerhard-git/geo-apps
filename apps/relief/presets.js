/**
 * Shaded relief — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "switzerland",
    name: "Switzerland — coloured by height",
    look: "alpine",
    country: "CH",
    set: { optHeight: true },
  },
  {
    id: "iceland",
    name: "Iceland — grey relief",
    look: "print",
    country: "IS",
  },
  {
    id: "nepal",
    name: "Nepal — with its neighbours",
    look: "classic",
    country: "NP",
    set: { optHeight: true },
    press: ["modeNeighbours"],
  },
  {
    id: "madagascar",
    name: "Madagascar — tropical",
    look: "forest",
    country: "MG",
    set: { optHeight: true },
  },
  {
    id: "peru",
    name: "Peru — the Andes",
    look: "sand",
    country: "PE",
    set: { optHeight: true },
  },
];

/**
 * The sheet's colour controls for a look: the background, the caption, and
 * the height colours (used when "Colour by height" is on).
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    capColor: look.ink,
    scheme: look.relief,
  },
});

/** "Random country" skips countries smaller than this (Malta, Palau): too little relief. */
export const MIN_RANDOM_AREA = 0.25;
