/**
 * Flag colours: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Turns a flag into a pie chart of its colours. How much of each colour there is gives the flag away, not the colours themselves.",
  options: [
    [
      "Which colours count",
      "Fold the small colours of an emblem into the main ones, and set the smallest slice and the most slices.",
    ],
    [
      "Chart",
      "Print the percentages, draw a ring instead of a pie, or turn the pie so a familiar flag looks less familiar. Printing the colour codes can give the answer away.",
    ],
  ],
};
