/**
 * Rivers: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws a country's rivers and lakes on their own, with no borders, cities or names. The Nile or the Amazon are easy; most rivers take more thought.",
  options: [
    ["Extent", "“Main landmass” leaves out far-off islands; “Everything” shows them all."],
    [
      "Water",
      "All rivers or only major ones, how thick and what colour, lakes, and a faint outline of the country as a hint.",
    ],
  ],
};
