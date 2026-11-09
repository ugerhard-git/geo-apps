/**
 * Our World in Data Charts: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Plots data from Our World in Data, such as life expectancy, CO₂ or internet use, for the countries and years you choose. Leave the country names off and the chart becomes a quiz.",
  steps: [
    "Look at the example that's already drawn, or pick a ready-made chart.",
    "Add or remove countries, and choose the years and the kind of chart.",
    "Download the chart as a picture when you're happy with it.",
  ],
  presets:
    "The plotter opens with an example. “Start from” has more, and backgrounds for the chart. “Random countries” swaps in three other countries; “Random background” changes only the background. Change something yourself and the menu shows “Custom”.",
};
