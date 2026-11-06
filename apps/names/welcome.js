/**
 * Baby names: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Lists a country's most popular baby names, for girls and boys. Names like Seo-yeon or Oisín narrow it down quickly.",
  options: [
    [
      "Girls' and boys' lists",
      "Lists for newborns come first, then lists of everyone's names; newest first.",
    ],
    [
      "Lists",
      "Girls, boys or both, the top 5 or top 10, and the spelling: Latin letters, the country's own script, or both.",
    ],
    ["Source and year on the sheet", "Says what each list is, and warns when it's old."],
    ["As text", "Copy the names, or download them as a text file."],
  ],
};
