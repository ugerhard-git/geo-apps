/**
 * Baby names — presets: examples to start from, and how a look colours
 * the lists. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "spain",
    name: "Spain",
    look: "classic",
    country: "ES",
  },
  {
    id: "ireland",
    name: "Ireland",
    look: "forest",
    country: "IE",
  },
  {
    id: "france",
    name: "France",
    look: "rose",
    country: "FR",
  },
  {
    id: "japan",
    name: "Japan",
    look: "sea",
    country: "JP",
  },
  {
    id: "greece",
    name: "Greece",
    look: "sand",
    country: "GR",
  },
];

/**
 * The colour controls of the lists for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { inkColor: look.ink, accentColor: look.accent, bgColor: look.paper },
});
