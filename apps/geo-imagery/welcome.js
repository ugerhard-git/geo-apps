/**
 * Country & City Imagery: the text of the welcome window (shared/welcome.js), which opens on
 * a visitor's first visit and from "How it works".
 */

/** @type {import("../../shared/welcome.js").Welcome} */
export const WELCOME = {
  intro:
    "Crops satellite pictures to one country or city: by day, or by night, when city lights show where people live.",
  options: [
    ["Country or city", "Frame a whole country, or zoom in on a city."],
    ["Imagery", "Day or night, which satellite pictures, and from which date."],
    [
      "Framing",
      "“Mainland” leaves out far-off islands. Move the frame, or choose another map projection.",
    ],
    ["Overlays", "Draw the country's outline, coastlines, borders or rivers on top."],
    [
      "Frame and caption",
      "The picture's size, the space around the country, and a caption and credit on the image or on a band of their own.",
    ],
    [
      "Export",
      "PNG or JPG. Names stay out of the file name unless you tick “Put the name in the filename”. “Also save a clean copy” saves a second picture without the caption.",
    ],
  ],
  basics: null,
  presets:
    "The app opens with an example already drawn. The “Start from” menu has more examples, and imagery: other satellite pictures of the same place, such as night lights or relief. “Random country” picks another country and keeps your settings; “Random imagery” picks other pictures and keeps the place. Change something yourself and the menu shows “Custom”: your changes stay until you pick a preset.",
};
