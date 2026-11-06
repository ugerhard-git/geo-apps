/**
 * Keyboards — presets: examples to start from, and how a look colours
 * the keyboard. Used by shared/presets.js; the first example is drawn on opening.
 */

import { mix } from "../../shared/looks.js";

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "france",
    name: "France — AZERTY",
    look: "classic",
    country: "FR",
  },
  {
    id: "germany",
    name: "Germany — QWERTZ with umlauts",
    look: "alpine",
    country: "DE",
  },
  {
    id: "greece",
    name: "Greece — Greek letters",
    look: "sea",
    country: "GR",
  },
  {
    id: "russia",
    name: "Russia — Cyrillic",
    look: "night",
    country: "RU",
  },
  {
    id: "thailand",
    name: "Thailand — Thai script",
    look: "sand",
    country: "TH",
  },
];

/**
 * The colour controls of the keyboard for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    keyColor: mix(look.paper, look.ink, 0.07),
    inkColor: look.ink,
    accentColor: look.accent,
    bgColor: look.paper,
  },
});
