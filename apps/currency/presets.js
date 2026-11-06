/**
 * Currency — presets: examples to start from, and how a look colours
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
    id: "switzerland",
    name: "Switzerland — the franc",
    look: "classic",
    country: "CH",
    set: { licFilter: "open" },
  },
  {
    id: "japan",
    name: "Japan — the yen",
    look: "sea",
    country: "JP",
    set: { licFilter: "open" },
  },
  {
    id: "germany",
    name: "Germany — the euro",
    look: "alpine",
    country: "DE",
    set: { licFilter: "open" },
  },
  {
    id: "uk",
    name: "United Kingdom — the pound",
    look: "rose",
    country: "GB",
    set: { licFilter: "open" },
  },
  {
    id: "india",
    name: "India — the rupee",
    look: "sand",
    country: "IN",
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
