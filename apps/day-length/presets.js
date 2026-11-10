/**
 * Day length — presets: examples to start from, and how a look colours the
 * sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

import { mix } from "../../shared/looks.js";

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "iceland",
    name: "Iceland — summer nights that never get dark",
    look: "classic",
    country: "IS",
    press: ["viewClock"],
  },
  {
    id: "spain",
    name: "Spain — late sunrises and summer time",
    look: "sand",
    country: "ES",
    press: ["viewClock"],
  },
  {
    id: "argentina",
    name: "Argentina — winter in June",
    look: "sea",
    country: "AR",
    press: ["viewClock"],
  },
  {
    id: "singapore",
    name: "Singapore — the same day all year",
    look: "forest",
    country: "SG",
    press: ["viewClock"],
  },
  {
    id: "finland",
    name: "Finland — hours of daylight",
    look: "alpine",
    country: "FI",
    press: ["viewHours"],
  },
];

/**
 * The sheet's colours for a look: its paper, text and highlight, with day,
 * twilight and night kept recognisable (a warm day, a blue twilight, a deep
 * blue night) and only tinted by the look, so the chart reads the same in
 * every look.
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    capColor: look.ink,
    dayColor: mix("#f4d58d", look.accent, 0.18),
    twilightColor: mix("#6f8fb0", look.second, 0.15),
    nightColor: mix("#1a2c45", look.second, 0.12),
    lineColor: look.accent,
  },
});
