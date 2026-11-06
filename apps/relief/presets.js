/**
 * Shaded relief — presets: examples to start from, and how a look colours
 * the sheet. Used by shared/presets.js; the first example is drawn on opening.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    id: "switzerland",
    name: "Switzerland — coloured by height",
    look: "alpine",
    country: "CH",
    set: { optHeight: true },
  },
  {
    id: "iceland",
    name: "Iceland — grey relief",
    look: "print",
    country: "IS",
  },
  {
    id: "nepal",
    name: "Nepal — with its neighbours",
    look: "classic",
    country: "NP",
    set: { optHeight: true },
    press: ["modeNeighbours"],
  },
  {
    id: "madagascar",
    name: "Madagascar — tropical",
    look: "forest",
    country: "MG",
    set: { optHeight: true },
  },
  {
    id: "peru",
    name: "Peru — the Andes",
    look: "sand",
    country: "PE",
    set: { optHeight: true },
  },
];

/**
 * The sheet's colour controls for a look: the background, the caption, and
 * the height colours (used when "Colour by height" is on).
 *
 * @param {import("../../shared/looks.js").Look} look
 */
export const lookToControls = (look) => ({
  set: {
    bgColor: look.paper,
    capColor: look.ink,
    scheme: look.relief,
  },
});

/**
 * A country's land area, roughly, in square degrees of latitude: enough to
 * tell a country with mountains to show from a speck of islands. (One square
 * degree is about 12,000 km².)
 *
 * @param {Array<Array<Array<[number, number]>>>} polys lon/lat polygons, outer ring first
 */
export function landArea(polys) {
  let sum = 0;
  for (const [outer] of polys) {
    if (!outer || outer.length < 3) continue;
    let a = 0;
    let lat = 0;
    for (let i = 0; i < outer.length; i++) {
      const [x0, y0] = outer[i];
      const [x1, y1] = outer[(i + 1) % outer.length];
      a += x0 * y1 - x1 * y0;
      lat += y0;
    }
    sum += (Math.abs(a) / 2) * Math.cos(((lat / outer.length) * Math.PI) / 180);
  }
  return sum;
}

/** "Random country" skips countries smaller than this (Malta, Palau): too little relief. */
export const MIN_RANDOM_AREA = 0.25;
