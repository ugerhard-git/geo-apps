/**
 * Endemics — presets: examples to start from, and how a look colours
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
    id: "madagascar",
    name: "Madagascar — found nowhere else",
    look: "forest",
    country: "MG",
    set: { licFilter: "open" },
  },
  {
    id: "australia",
    name: "Australia — marsupials and more",
    look: "sand",
    country: "AU",
    set: { licFilter: "open" },
  },
  {
    id: "ecuador",
    name: "Ecuador — the Galápagos and the Andes",
    look: "sea",
    country: "EC",
    set: { licFilter: "open" },
  },
  {
    id: "newzealand",
    name: "New Zealand — birds without enemies",
    look: "alpine",
    country: "NZ",
    set: { licFilter: "open" },
  },
  {
    id: "cuba",
    name: "Cuba — island species",
    look: "classic",
    country: "CU",
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
