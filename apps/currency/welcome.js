/**
 * Currency sheets: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Puts a country's banknotes and coins on a quiz sheet, with facts about its money if you like. The photos come from Wikimedia Commons.",
  options: [
    [
      "Photos",
      "Six photos are put on the sheet for you. In the list below the sheet, click a photo to add or remove it. “Licences to offer” sets which photos are listed; photos that need their author credited get a credit on the sheet.",
    ],
    [
      "Currency facts",
      "Add the currency's symbol, the name of its unit and of its smaller units, above or below the photos. The names often give a lot away.",
    ],
    [
      "Banknote images",
      "Prints “SPECIMEN” across the notes. Many countries restrict copies of banknotes; the note in the app says more.",
    ],
  ],
};
