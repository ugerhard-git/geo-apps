/**
 * Landmarks — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 *
 * Examples use openly licensed photos only (public domain, CC0, CC BY),
 * whose authors the sheet credits; the app then picks the first
 * photos (see `autoPick` in main.js).
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "italy",
    name: "Italy",
    look: "classic",
    country: "IT",
    set: { licFilter: "open" },
  },
  {
    id: "ethiopia",
    name: "Ethiopia",
    look: "sand",
    country: "ET",
    set: { licFilter: "open" },
  },
  {
    id: "peru",
    name: "Peru",
    look: "alpine",
    country: "PE",
    set: { licFilter: "open" },
  },
  {
    id: "japan",
    name: "Japan",
    look: "sea",
    country: "JP",
    set: { licFilter: "open" },
  },
  {
    id: "egypt",
    name: "Egypt",
    look: "rose",
    country: "EG",
    set: { licFilter: "open" },
  },
];

/**
 * The colour controls of the sheet for a look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: { fgColor: look.ink, bgColor: look.paper, atColor: look.ink },
});
