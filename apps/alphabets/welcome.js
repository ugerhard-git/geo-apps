/**
 * Alphabets by country: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows the letters a country's languages are written with, laid out as a quiz sheet. Extra letters such as þ, ñ or ł are often enough to place it.",
  options: [
    [
      "Country and languages",
      "Pick a country, then one or more of its languages. Each language gets its own alphabet.",
    ],
    [
      "Contents",
      "Add loanword letters, an example sentence, or capitals next to the small letters. Leave “Name the languages” off and each alphabet gets a neutral heading instead.",
    ],
    ["Copy as text", "Copies the letters as plain text, to paste into a document."],
  ],
};
