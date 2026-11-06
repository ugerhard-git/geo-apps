/**
 * Keyboard layouts: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Draws a country's keyboard, key by key: QWERTY, QWERTZ or AZERTY, its accented letters, its own alphabet.",
  options: [
    ["Layout", "The country's usual keyboard comes first, then others used there."],
    [
      "Keyboard",
      "The shape of the keyboard (as sold there, ISO or ANSI), and which characters are printed on the keys: with Shift, with AltGr, Latin letters next to another script, and the bottom row.",
    ],
  ],
};
