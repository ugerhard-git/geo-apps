/**
 * Geo: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws a set of cards with facts about a country, such as area, population, languages, currencies and neighbours, to download one by one or as a sheet.",
  options: [
    [
      "Statistics",
      "Choose which cards go on the sheet: tick more in the list, remove one with ×, or reset to the standard six. Cards appear in the order you chose them.",
    ],
    ["Cards", "Light or dark cards, or your own colours for card, text and background."],
    [
      "Reference data",
      "Facts come from an open data set. With a free REST Countries key you get fourteen more, such as time zones and the side of the road people drive on. The key is only stored in your browser.",
    ],
    ["Download", "Each card as its own picture, all cards on one sheet, or as text."],
  ],
  basics: null,
};
