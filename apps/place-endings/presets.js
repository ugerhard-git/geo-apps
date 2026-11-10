/**
 * Place-name endings — presets: examples to start from, and how a look
 * colours the sheet. Used by shared/presets.js; the first example is drawn
 * on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "sweden",
    name: "Sweden — -torp, -fors and -holm",
    look: "classic",
    country: "SE",
    press: ["viewCloud"],
  },
  {
    id: "mexico",
    name: "Mexico — -tepec, -tla and -pan",
    look: "sand",
    country: "MX",
    press: ["viewCloud"],
  },
  {
    id: "india",
    name: "India — -pur, -garh and -ganj",
    look: "rose",
    country: "IN",
    press: ["viewCloud"],
  },
  {
    id: "poland",
    name: "Poland — twelve towns",
    look: "sea",
    country: "PL",
    press: ["viewTowns"],
  },
  {
    id: "denmark",
    name: "Denmark — -rup, -lev and -bjerg",
    look: "chalk",
    country: "DK",
    press: ["viewCloud"],
  },
];

/**
 * The sheet's colour controls for a look: the background, the text, and the
 * two highlights the endings take turns in.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    capColor: look.ink,
    accentColor: look.accent,
    secondColor: look.second,
  },
});
