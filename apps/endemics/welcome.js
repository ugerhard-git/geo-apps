/**
 * Endemic animals: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Shows animals that live in one country and nowhere else. A lemur says Madagascar, a kiwi New Zealand. The photos come from Wikimedia Commons.",
  options: [
    [
      "Photos",
      "Six photos are put on the sheet for you. In the list below the sheet, click a photo to add or remove it. “Licences to offer” sets which photos are listed; photos that need their author credited get a credit on the sheet.",
    ],
    [
      "Print the species names",
      "Names each animal under its photo. That can give the country away.",
    ],
  ],
};
