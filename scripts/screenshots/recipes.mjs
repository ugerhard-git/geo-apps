/**
 * How to make each app's picture for the overview page: which country, which
 * settings, and what to capture. Read by take.mjs.
 *
 * Each recipe is a list of steps, run in order on the app's page:
 *
 *   { country: "Japan" }             type into #country, pick the match
 *   { select: ["#id", "value"] }     choose an option in a <select>
 *   { check: "#id" } / { uncheck }   tick or untick a box
 *   { fill: ["#id", "text"] }        type into a field
 *   { click: "selector", count: 6 }  click the first N matches (default 1)
 *   { hide: "selector" }             leave something out of the picture
 *   { wait: 2000 }                   wait this many milliseconds
 *
 * After the steps, take.mjs waits until the page has finished loading and
 * captures `capture` (default "#sheet"). A canvas is read directly; any other
 * element is photographed.
 *
 * Apps with photos from Commons use public-domain files only (`#licFilter`
 * set to "pd"), so the pictures need no credits on the overview. Where that
 * leaves too few photos, "open" adds CC BY files, and the sheet's own credit
 * line names their authors.
 *
 * `alt` describes the picture for people who can't see it.
 */

/**
 * @typedef {object} Step
 * @property {string} [country]
 * @property {[string, string]} [select]
 * @property {string} [check]
 * @property {string} [uncheck]
 * @property {[string, string]} [fill]
 * @property {string} [click]
 * @property {number} [count]
 * @property {string} [hide]
 * @property {number} [wait]
 */

/**
 * @typedef {object} Recipe
 * @property {Step[]} steps
 * @property {string} [capture] the element to capture (default "#sheet")
 * @property {string} alt
 */

/** Photo apps: public-domain files only, then the first few put on the sheet. */
const PD = { select: /** @type {[string, string]} */ (["#licFilter", "pd"]) };
/** Public domain, CC0 and CC BY, for apps with too few public-domain photos. */
const OPEN = { select: /** @type {[string, string]} */ (["#licFilter", "open"]) };

/** @type {Record<string, Recipe>} */
export const RECIPES = {
  alphabets: {
    steps: [{ country: "Iceland" }],
    alt: "The Icelandic alphabet, with þ and ð, laid out as a quiz sheet",
  },
  "city-dots": {
    steps: [{ country: "Egypt" }],
    alt: "Egypt's cities as dots, tracing the Nile",
  },
  climate: {
    steps: [{ country: "India" }],
    alt: "A climate chart for India, with monsoon rain in summer",
  },
  currency: {
    steps: [PD, { country: "Japan" }, { click: ".tile .thumb", count: 4 }],
    alt: "Old Japanese banknotes on a quiz sheet",
  },
  endemics: {
    steps: [OPEN, { country: "Madagascar" }, { click: ".tile .thumb", count: 6 }],
    alt: "Animals found only in Madagascar",
  },
  // export-treemap has no recipe: OEC, its data source, turns away requests
  // from GitHub's servers, so its picture can't be taken there. Export a PNG
  // from the app instead and save it as site/shots/export-treemap.webp, with
  // an entry in shots.json.
  factfile: {
    steps: [{ country: "Hungary" }],
    alt: "A fact card about Hungary, with every name blacked out",
  },
  flagcolours: {
    steps: [{ country: "South Africa" }],
    alt: "The colours of South Africa's flag, measured and shown as a pie chart",
  },
  "geo-imagery": {
    steps: [{ fill: ["#q", "Egypt"] }, { click: "#results button" }],
    capture: "#preview",
    alt: "A satellite image of Egypt",
  },
  geocards: {
    steps: [{ country: "Mongolia" }],
    capture: "#grid",
    alt: "Statistics cards about Mongolia",
  },
  keyboards: {
    steps: [{ country: "France" }],
    alt: "The French AZERTY keyboard layout",
  },
  landmarks: {
    steps: [OPEN, { country: "Italy" }, { click: ".tile .thumb", count: 6 }],
    alt: "Photos of landmarks in Italy",
  },
  letters: {
    steps: [{ country: "Poland" }],
    alt: "How often each letter is used in Polish, with ł, ż and ś",
  },
  names: {
    steps: [{ country: "Spain" }],
    alt: "The most popular baby names in Spain",
  },
  outlines: {
    steps: [{ country: "Greece" }],
    alt: "The outline of Greece and its islands",
  },
  "owid-chart-plotter": {
    steps: [
      { wait: 3000 },
      { fill: ["#search", "Japan"] },
      { click: "#picker button" },
      { fill: ["#search", "Nigeria"] },
      { click: "#picker button" },
      { fill: ["#search", "Brazil"] },
      { click: "#picker button" },
      { hide: ".tablefoot .acts" },
    ],
    capture: ".table",
    alt: "Life expectancy over time in three countries",
  },
  plates: {
    steps: [OPEN, { country: "Netherlands" }, { click: ".tile .thumb", count: 6 }],
    alt: "Dutch licence plates, blurred, on a quiz sheet",
  },
  relief: {
    steps: [{ country: "Switzerland" }],
    alt: "A shaded relief map of Switzerland's mountains",
  },
  rivers: {
    steps: [{ country: "Brazil" }],
    alt: "The rivers of Brazil, led by the Amazon",
  },
  roadsigns: {
    steps: [PD, { country: "Sweden" }, { click: ".tile .thumb", count: 8 }],
    alt: "Swedish road signs, including the moose warning",
  },
  statistics: {
    steps: [{ country: "India" }],
    alt: "Charts of India's languages, religions and economy",
  },
  subdivisions: {
    steps: [{ country: "Australia" }],
    alt: "Australia's states and territories",
  },
};
