/**
 * Shaded relief: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws a country's mountains and plains as a shaded relief map, with no borders, rivers or names. The lie of the land is the clue.",
  options: [
    ["Extent", "“Main landmass” leaves out far-off islands; “Everything” shows them all."],
    [
      "Show the country",
      "With its outline, blended into the background, or with its neighbours around it.",
    ],
    [
      "Terrain",
      "How steep the slopes look, and the colours by height, for ground and shadows, and where the light comes from.",
    ],
    ["Note", "A short line for the players, such as “Heights are exaggerated.”"],
  ],
};
