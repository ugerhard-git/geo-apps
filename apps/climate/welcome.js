/**
 * Climate charts: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws the climate of one of a country's towns: the average temperature and the rain or snow of each month, from thirty years of weather. The shape of the seasons is the clue.",
  options: [
    ["Town", "The capital, or one of the country's largest towns."],
    [
      "Chart",
      "Units (°C and mm, or °F and inches), the scale, and the month the year starts in. July suits the southern hemisphere. On the Walter–Lieth scale, months where the rain bars stay below the temperature line are dry.",
    ],
    [
      "Band and figures",
      "The range from daily low to daily high, the figures along the axes, and each month's values.",
    ],
    ["Footnote", "Shows the yearly averages. Change it or clear it."],
  ],
};
