/**
 * Country statistics — presets: examples to start from, and how a look
 * colours the sheet. Used by shared/presets.js; the first example is drawn on
 * opening.
 *
 * An example's `extra.stats` names the charts to show, in order; any the
 * country has no data for are left out.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "india",
    name: "India — people and economy",
    look: "night",
    country: "IN",
    extra: { stats: ["languages", "religion", "age", "employment"] },
  },
  {
    id: "switzerland",
    name: "Switzerland — languages and energy",
    look: "classic",
    country: "CH",
    extra: { stats: ["languages", "religion", "electricity", "exports"] },
  },
  {
    id: "brazil",
    name: "Brazil — land and energy",
    look: "forest",
    country: "BR",
    extra: { stats: ["land", "electricity", "energy", "exports"] },
  },
  {
    id: "nigeria",
    name: "Nigeria — six charts",
    look: "sand",
    country: "NG",
    extra: { stats: ["languages", "religion", "ethnicity", "age", "urban", "deaths"] },
  },
  {
    id: "norway",
    name: "Norway — black and white",
    look: "print",
    country: "NO",
    extra: { stats: ["electricity", "exports", "employment", "diet"] },
  },
];

/**
 * The sheet's colour controls for a look: background, text and the chart
 * palette.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    fgColor: look.ink,
    palette: look.chart,
  },
});
