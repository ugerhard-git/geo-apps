/**
 * Country statistics: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws charts about a country, such as its languages, religions and economy, on one quiz sheet.",
  options: [
    ["Statistics", "Below the sheet, choose which charts go on it."],
    [
      "Labels on the sheet",
      "Untick a name to show it as “?”. Names that give the country away, such as its own language, start hidden.",
    ],
    ["Sheet", "The palette, percentages and a source line on each chart."],
    ["Note", "A short line for the players, such as “Latest year with data for each chart.”"],
  ],
};
