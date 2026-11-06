/**
 * Subdivision clouds: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows a country's states, regions or provinces as a word cloud, each name sized by population or area. Players work out which country is divided up like this.",
  options: [
    ["Sized by", "Population or area."],
    [
      "How many to show",
      "Large countries have many regions; show some of them, and shuffle for a different selection.",
    ],
    [
      "Cloud",
      "Wrapped lines or a spiral, a palette, some names turned sideways, and the figures if you like. “Drop the repeated word” takes out words like “Province” that every name has.",
    ],
  ],
};
