/**
 * Rivers — presets: examples to start from, and how a look colours
 * the map. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "brazil",
    name: "Brazil — the Amazon",
    look: "classic",
    country: "BR",
  },
  {
    id: "egypt",
    name: "Egypt — the Nile",
    look: "sand",
    country: "EG",
  },
  {
    id: "russia",
    name: "Russia — rivers to the Arctic",
    look: "sea",
    country: "RU",
  },
  {
    id: "india",
    name: "India — the Ganges and more",
    look: "forest",
    country: "IN",
  },
  {
    id: "germany",
    name: "Germany — with a faint outline",
    look: "alpine",
    country: "DE",
    set: { optOutline: true },
  },
];

/**
 * The colour controls of the map for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { waterColor: look.second, bgColor: look.paper, capColor: look.ink },
});
