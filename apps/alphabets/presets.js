/**
 * Alphabets — presets: examples to start from, and how a look colours the
 * sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "iceland",
    name: "Iceland — þ, ð and æ",
    look: "classic",
    country: "IS",
  },
  {
    id: "vietnam",
    name: "Vietnam — letters with tone marks",
    look: "sea",
    country: "VN",
    set: { optSentence: true },
  },
  {
    id: "greece",
    name: "Greece — the Greek alphabet",
    look: "sand",
    country: "GR",
  },
  {
    id: "georgia",
    name: "Georgia — Georgian script",
    look: "night",
    country: "GE",
    set: { optSentence: true },
  },
  {
    id: "poland",
    name: "Poland — black and white",
    look: "print",
    country: "PL",
    set: { optPairs: true },
  },
];

/**
 * The sheet's colour controls for a look: background and letters.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    fgColor: look.ink,
  },
});
