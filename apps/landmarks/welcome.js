/**
 * Landmarks: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Puts photos of a country's best-known buildings and natural wonders on a quiz sheet. The photos come from Wikimedia Commons.",
  options: [
    [
      "Photos",
      "Six photos are put on the sheet for you. In the list below the sheet, click a photo to add or remove it. “Licences to offer” sets which photos are listed; photos that need their author credited get a credit on the sheet.",
    ],
    ["Show", "All landmarks, or only buildings, or only natural ones."],
    ["Other photos", "Click a landmark in the list to choose another photo of it."],
    ["Name the landmarks", "Names each landmark under its photo. That gives a lot away."],
  ],
};
