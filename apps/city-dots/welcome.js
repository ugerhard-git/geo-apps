/**
 * City dots: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows a country's largest towns and cities as plain dots, sized by population, with no borders and no names. The pattern of where people live is the clue.",
  options: [
    [
      "Extent",
      "“Main landmass” leaves out far-off islands and territories; “Everything” shows them all.",
    ],
    [
      "Dots",
      "How many cities, whether the dots grow with population, and their size and colour. Leaving out towns inside a bigger city's dot keeps big cities from looking like clusters.",
    ],
    ["Faint country outline, ring the capital", "Extra hints, for an easier clue."],
    ["Footnote", "A line along the bottom that says what the dots show. Change it or clear it."],
  ],
};
