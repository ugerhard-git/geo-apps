/**
 * Licence plate sheets: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Puts a country's licence plates on a quiz sheet, blurred so the plate numbers can't be read. Colours, shapes and bands still give the country away. The photos come from Wikimedia Commons.",
  options: [
    [
      "Photos",
      "Six photos are put on the sheet for you. In the list below the sheet, click a photo to add or remove it. “Licences to offer” sets which photos are listed; photos that need their author credited get a credit on the sheet.",
    ],
    [
      "Blur",
      "Blur the whole photo, or only boxes you draw, such as over the numbers or a country code. Set how strong the blur is.",
    ],
    [
      "Sheet",
      "Group the plates by kind with headings, and add the plate's size and format if you like.",
    ],
  ],
};
