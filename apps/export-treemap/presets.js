/**
 * Export treemaps — presets: examples to start from, and how a look colours
 * the treemap. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "chile",
    name: "Chile — copper",
    look: "classic",
    country: "CL",
  },
  {
    id: "saudi",
    name: "Saudi Arabia — oil",
    look: "sand",
    country: "SA",
  },
  {
    id: "japan",
    name: "Japan — cars and machines",
    look: "sea",
    country: "JP",
  },
  {
    id: "nigeria",
    name: "Nigeria — oil and gas",
    look: "forest",
    country: "NG",
  },
  {
    id: "switzerland",
    name: "Switzerland — gold, medicines and watches",
    look: "alpine",
    country: "CH",
  },
];

/**
 * The colour controls of the treemap for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({ set: { fgColor: look.ink, bgColor: look.paper } });
