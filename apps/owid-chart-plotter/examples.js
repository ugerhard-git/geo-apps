/**
 * OWID chart plotter — starting points (shared/presets.js): a ready-made
 * chart and a few countries to compare, drawn on opening. (The list of
 * ready-made charts itself is in presets.js.)
 *
 * Here a "look" is the chart's background, and "Random country" swaps in three
 * random countries that have data in the chart shown.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/** The backgrounds, as looks. @type {Array<{id: string, name: string}>} */
export const LOOKS = [
  { id: "white", name: "White" },
  { id: "paper", name: "Paper" },
  { id: "ink", name: "Dark" },
];

/**
 * No `country`: an example names its chart and countries in `extra`, which
 * main.js loads.
 *
 * @type {Example[]}
 */
export const EXAMPLES = [
  {
    id: "life",
    name: "Life expectancy — Japan, Nigeria, Brazil",
    look: "white",
    extra: { slug: "life-expectancy", entities: ["Japan", "Nigeria", "Brazil"] },
  },
  {
    id: "co2",
    name: "CO₂ per person — USA, China, India, Germany",
    look: "paper",
    extra: {
      slug: "co-emissions-per-capita",
      entities: ["United States", "China", "India", "Germany"],
    },
  },
  {
    id: "fertility",
    name: "Fertility — South Korea, Niger, France",
    look: "white",
    extra: { slug: "children-born-per-woman", entities: ["South Korea", "Niger", "France"] },
  },
  {
    id: "internet",
    name: "Internet users — Iceland, Kenya, Peru",
    look: "ink",
    extra: {
      slug: "share-of-individuals-using-the-internet",
      entities: ["Iceland", "Kenya", "Peru"],
    },
  },
  {
    id: "tourism",
    name: "Tourist arrivals — Spain, France, Mexico",
    look: "paper",
    extra: { slug: "international-tourist-trips", entities: ["Spain", "France", "Mexico"] },
  },
];

/**
 * The background menu for a look.
 *
 * @param {{id: string}} look
 */
export const lookToControls = (look) => ({ set: { bg: look.id } });
