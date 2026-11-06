/**
 * Letter frequencies: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows how often a language uses each letter, as a bar chart. Its ä, ł or ʻ, and how often they come up, point to the country.",
  options: [
    ["Language", "The country's official languages written in Latin letters, largest first."],
    [
      "Chart",
      "Sort by frequency or alphabetically, keep or hide letters beyond a–z (hiding them makes it harder), highlight them, and compare with English.",
    ],
    [
      "Leave out rare letters",
      "The rarest letters are mostly from foreign words, such as é in German.",
    ],
  ],
};
