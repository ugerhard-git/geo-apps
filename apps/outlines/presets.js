/**
 * Outlines — presets: examples to start from, and how a look colours
 * the outline. Used by shared/presets.js; the first example is drawn on opening.
 * Countries are named as Natural Earth names them, which is how this app
 * finds its outlines.
 */

import { mix } from "../../shared/looks.js";

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "greece",
    name: "Greece — islands and all",
    look: "classic",
    country: "Greece",
  },
  {
    id: "norway",
    name: "Norway — fjords",
    look: "sea",
    country: "Norway",
  },
  {
    id: "chile",
    name: "Chile — long and thin",
    look: "sand",
    country: "Chile",
  },
  {
    id: "indonesia",
    name: "Indonesia — thousands of islands",
    look: "forest",
    country: "Indonesia",
  },
  {
    id: "italy",
    name: "Italy — the boot, as a hole",
    look: "rose",
    country: "Italy",
    set: { fillNone: true },
  },
];

/**
 * The colour controls of the outline for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    lineColor: look.ink,
    fillColor: mix(look.paper, look.accent, 0.3),
    bgColor: look.paper,
    capColor: look.ink,
  },
});
