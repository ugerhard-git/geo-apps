/**
 * Outlines: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws a country or one of its regions as a bare outline, turned around so it takes work to place.",
  options: [
    ["Draw", "A whole country, or one of its regions."],
    ["Extent", "“Main landmass” leaves out far-off islands; “Everything” shows them all."],
    [
      "Turn it around",
      "Rotate or mirror the shape. Upside down, even a familiar country is hard to spot.",
    ],
    [
      "Ink",
      "The outline's colour and weight, and the fill. The fill can be a hole, so the background shows through.",
    ],
  ],
};
