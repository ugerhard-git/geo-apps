/**
 * Our World in Data Charts: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Plots data from Our World in Data, such as life expectancy, CO₂ or internet use, for the countries and years you choose. Leave the country names off and the chart becomes a quiz.",
  options: [
    [
      "Ready-made charts",
      "Search for a topic, or press “Browse all” to see every chart there is. You can also paste the address of any chart on ourworldindata.org.",
    ],
    ["Countries", "Type a name and press Enter. Up to eight countries; click one to remove it."],
    [
      "Chart type",
      "Lines over time, stacked areas, grouped bars, a ranking, shares or the change between two years. Single-year charts use the “To” year.",
    ],
    ["Look", "Title, value axis, point marks, country names and background."],
    [
      "Legend",
      "Off by default, so the picture names no countries. Turn it on to label each colour, with the country's name or your own words such as “Country A”.",
    ],
    ["Download", "The chart as a PNG picture, or the data as a CSV file."],
  ],
  basics: null,
  steps: [
    "Look at the example that's already drawn, or pick a ready-made chart.",
    "Add or remove countries, and choose the years and the kind of chart.",
    "Download the chart as a picture when you're happy with it.",
  ],
  presets:
    "The plotter opens with an example already drawn. The “Start from” menu has more examples, and backgrounds for the chart. “Random countries” swaps in three random countries and keeps the chart; “Random background” changes only the background. Change something yourself and the menu shows “Custom”: your changes stay until you pick a preset.",
};
