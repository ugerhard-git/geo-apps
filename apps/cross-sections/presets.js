/**
 * Cross-sections — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "chile",
    name: "Chile — from the Pacific up the Andes",
    look: "classic",
    country: "CL",
    press: ["dirWE"],
    set: { through: "capital" },
  },
  {
    id: "nepal",
    name: "Nepal — into the Himalaya",
    look: "alpine",
    country: "NP",
    press: ["dirSN"],
    set: { through: "capital" },
  },
  {
    id: "switzerland",
    name: "Switzerland — over its highest point",
    look: "sea",
    country: "CH",
    press: ["dirSN"],
    set: { through: "highest" },
  },
  {
    id: "ethiopia",
    name: "Ethiopia — the highlands",
    look: "sand",
    country: "ET",
    press: ["dirWE"],
    set: { through: "capital" },
  },
  {
    id: "netherlands",
    name: "Netherlands — flat as it is",
    look: "forest",
    country: "NL",
    press: ["dirWE"],
    set: { through: "capital" },
  },
];

/**
 * The sheet's colour controls for a look: the background, the text and
 * lines, and the land.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    capColor: look.ink,
    landColor: look.accent,
  },
});

/** "Random country" skips countries smaller than this (Malta, Palau): too short a line. */
export const MIN_RANDOM_AREA = 0.25;
