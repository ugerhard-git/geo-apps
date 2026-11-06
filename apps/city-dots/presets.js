/**
 * City dots — presets: examples to start from, and how a look colours
 * the dots. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "croatia",
    name: "Croatia — Zagreb and the coast",
    look: "poster",
    country: "HR",
  },
  {
    id: "egypt",
    name: "Egypt — cities along the Nile",
    look: "sand",
    country: "EG",
  },
  {
    id: "chile",
    name: "Chile — a long, thin line",
    look: "night",
    country: "CL",
  },
  {
    id: "japan",
    name: "Japan — with a faint outline",
    look: "sea",
    country: "JP",
    set: { optOutline: true },
  },
  {
    id: "nigeria",
    name: "Nigeria — the capital ringed",
    look: "forest",
    country: "NG",
    set: { optCapital: true },
  },
];

/**
 * The colour controls of the dots for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { bgColor: look.paper, dotColor: look.ink, capColor: look.accent },
});
