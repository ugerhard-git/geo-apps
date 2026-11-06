/**
 * Letter frequencies — presets: examples to start from, and how a look colours
 * the chart. Used by shared/presets.js; the first example is drawn on opening.
 */

import { mix } from "../../shared/looks.js";

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "poland",
    name: "Poland — ł, ż and ś",
    look: "classic",
    country: "PL",
  },
  {
    id: "spain",
    name: "Spain — ñ highlighted",
    look: "sand",
    country: "ES",
    set: { optHighlight: true },
  },
  {
    id: "germany",
    name: "Germany — compared with English",
    look: "alpine",
    country: "DE",
    set: { optCompare: true },
  },
  {
    id: "iceland",
    name: "Iceland — þ and ð",
    look: "sea",
    country: "IS",
  },
  {
    id: "turkey",
    name: "Turkey — ı, ğ and ş highlighted",
    look: "rose",
    country: "TR",
    set: { optHighlight: true },
  },
];

/**
 * The colour controls of the chart for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    barColor: look.accent,
    accentColor: look.second,
    inkColor: look.ink,
    bgColor: look.paper,
    cmpColor: mix(look.paper, look.ink, 0.3),
  },
});
