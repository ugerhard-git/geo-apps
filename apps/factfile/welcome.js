/**
 * Fact file: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Makes a fact card about a country: climate, terrain, borders, economy and politics, with every name blacked out. Players work out the country from the facts alone.",
  options: [
    ["On the card", "Which facts the card shows."],
    [
      "Blacking out",
      "The country's own names, its people, cities, neighbours, mountains and rivers are always blacked out. You can black out seas and continents too. Below the card you can show or hide each name.",
    ],
    ["Fill the card", "Makes the text bigger when there's room."],
    ["Note", "A short line for the players, such as “Every name is blacked out.”"],
  ],
};
