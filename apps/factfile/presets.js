/**
 * Fact file — presets: examples to start from, and how a look colours the
 * card. Used by shared/presets.js; the first example is drawn on opening.
 */

import { FIELDS } from "./config.js";

/** @typedef {import("../../shared/presets.js").Example} Example */

/**
 * Tick boxes for exactly these fields, all others off.
 *
 * @param {string[]} ids
 * @returns {Record<string, boolean>}
 */
const only = (ids) => Object.fromEntries(FIELDS.map((f) => [`f-${f.id}`, ids.includes(f.id)]));

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "hungary",
    name: "Hungary — the standard card",
    look: "classic",
    country: "HU",
  },
  {
    id: "iceland",
    name: "Iceland — land and nature",
    look: "alpine",
    country: "IS",
    set: only([
      "climate",
      "terrain",
      "heights",
      "coast",
      "hazards",
      "area",
      "lake",
      "river",
      "resources",
    ]),
  },
  {
    id: "japan",
    name: "Japan — politics",
    look: "sea",
    country: "JP",
    set: {
      ...only([
        "system",
        "parliament",
        "independence",
        "regions",
        "legal",
        "holiday",
        "memberships",
        "city",
      ]),
      optFrom: true,
    },
  },
  {
    id: "egypt",
    name: "Egypt — the Nile and its people",
    look: "sand",
    country: "EG",
    set: only([
      "climate",
      "terrain",
      "river",
      "farm",
      "city",
      "languages",
      "religions",
      "age",
      "independence",
      "holiday",
    ]),
  },
  {
    id: "chile",
    name: "Chile — night card",
    look: "night",
    country: "CL",
    set: { optWater: true },
  },
];

/**
 * The card's colour controls for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    paperColor: look.paper,
    inkColor: look.ink,
    accentColor: look.accent,
    barColor: look.ink,
  },
});
