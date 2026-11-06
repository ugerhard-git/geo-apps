/**
 * Road signs: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Puts a country's official road signs on a quiz sheet. Their shapes, colours and lettering say more than you'd think. The pictures come from Wikimedia Commons.",
  options: [
    [
      "Photos",
      "Six photos are put on the sheet for you. In the list below the sheet, click a photo to add or remove it. “Licences to offer” sets which photos are listed; photos that need their author credited get a credit on the sheet.",
    ],
    [
      "Lettering on signs",
      "Blurs the selected signs, so place names and words don't give the country away.",
    ],
  ],
};
