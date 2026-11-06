/**
 * Export treemaps: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows what a country sells abroad, as blocks without labels: the bigger the block, the more it earns; the colour shows the kind of product. Oil, cars or coffee point to very different places.",
  options: [
    [
      "Year",
      "The year of the trade figures. If a year has no data yet, the app goes back until it finds some.",
    ],
    [
      "Shape and labels",
      "The shape of the picture, and which blocks get a label. Small blocks stay bare.",
    ],
    ["Smallest product shown", "Raise it to drop the thinnest slivers."],
    ["Hide the answer below the image", "Keeps the country's name off the picture."],
    ["Download", "PNG, JPG or SVG, in the resolution you choose."],
    [
      "Blocked by your browser?",
      "If the trade data won't load, this explains how to fetch it by hand and paste it in.",
    ],
  ],
  basics: null,
};
