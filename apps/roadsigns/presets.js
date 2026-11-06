/**
 * Road signs — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 *
 * Examples use openly licensed photos only (public domain, CC0, CC BY),
 * whose authors the sheet credits; the app then picks the first
 * photos, one of each kind in turn (see `autoPick` in main.js).
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "sweden",
    name: "Sweden",
    look: "classic",
    country: "SE",
    set: { licFilter: "open" },
  },
  {
    id: "usa",
    name: "United States",
    look: "sand",
    country: "US",
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
    id: "australia",
    name: "Australia",
    look: "forest",
    country: "AU",
    set: { licFilter: "open" },
  },
  {
    id: "germany",
    name: "Germany",
    look: "alpine",
    country: "DE",
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
