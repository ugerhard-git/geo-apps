/**
 * Fact file — finding the names in a text that could give the country away.
 *
 * Two rules:
 *   1. The country's known names — its own names, its people, its cities,
 *      peaks, lakes, rivers, regions and neighbours — are always found.
 *   2. In free text, every other place name is found too: any run of
 *      capitalised words ("Mount Fuji", "Ring of Fire"). Other countries'
 *      names ("civil law based on the German model"), seas, oceans and
 *      continents are clues, not the answer, so they are found but left
 *      visible; seas and the rest can be blacked out with an option.
 *
 * The app then shows every name found with a tick box, so the user has the
 * last word. Pure functions, so they can be tested without a browser.
 */

/**
 * @typedef {object} Part
 * @property {string} text
 * @property {string | null} term the name this part is, if it is one
 * @property {boolean} auto whether the name is blacked out unless the user says otherwise
 * @property {"own" | "place" | "country" | "water" | null} why how it was found:
 *   one of the country's known names, another place name, another country,
 *   or a sea, ocean or continent
 */

/**
 * @typedef {object} Context
 * @property {string[]} names the country's known names (rule 1)
 * @property {Set<string>} others other countries' names and adjectives
 * @property {boolean} broad apply rule 2
 * @property {boolean} water black out seas, oceans and continents too
 */

/** Words for water: a name with one of these in it is a sea or a bay. */
const WATER =
  /\b(?:Ocean|Oceans|Sea|Seas|Gulf|Bay|Bight|Strait|Straits|Channel|Lagoon|Sound|Passage)\b/;

/** Continents and great regions, with their adjectives. */
const CONTINENTS = new Set(
  [
    "Africa",
    "African",
    "Asia",
    "Asian",
    "Europe",
    "European",
    "Antarctica",
    "Antarctic",
    "Arctic",
    "Oceania",
    "America",
    "Americas",
    "North America",
    "South America",
    "Central America",
    "Latin America",
    "Atlantic",
    "Pacific",
    "Indian",
    "Mediterranean",
    "Caribbean",
    "Middle East",
    "Eurasia",
    "Sahara",
    "Sahel",
  ].map((s) => s.toLowerCase()),
);

/**
 * Capitalised words that aren't places: months, faiths, legal traditions,
 * and abbreviations used as plain words.
 */
const NOT_PLACES = new Set(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Islamic",
    "Islam",
    "Muslim",
    "Christian",
    "Christianity",
    "Catholic",
    "Roman Catholic",
    "Orthodox",
    "Protestant",
    "Buddhist",
    "Buddhism",
    "Hindu",
    "Jewish",
    "Anglo-American",
    "English common law",
    "Roman",
    "Napoleonic",
    "Soviet",
    "Ottoman",
    "Sharia",
    "UN",
    "EU",
    "UTC",
    "GDP",
    "Constitution",
    "Supreme Court",
  ].map((s) => s.toLowerCase()),
);

/** Letters and digits: a name only matches as a whole word. */
const EDGE = "[\\p{L}\\p{M}\\p{N}]";

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A run of capitalised words, joined by small linking words: "Mount Fuji",
 * "Gulf of Thailand", "Bay of Bengal".
 */
const CAPITALISED =
  /(?<![\p{L}\p{M}\p{N}])\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+(?:of|the|de|del|da|do|la|le|al|el|and)\s+\p{Lu}[\p{L}\p{M}'’.-]*|\s+\p{Lu}[\p{L}\p{M}'’.-]*)*/gu;

/**
 * Whether a name is a sea, an ocean or a continent.
 *
 * @param {string} name
 */
export function isWater(name) {
  return WATER.test(name) || CONTINENTS.has(name.toLowerCase());
}

/**
 * Split a text into plain parts and names.
 *
 * @param {string} text
 * @param {Context} ctx
 * @returns {Part[]}
 */
export function analyse(text, ctx) {
  /** @type {Array<{start: number, end: number, term: string, auto: boolean, why: Part["why"]}>} */
  const found = [];
  const taken = new Uint8Array(text.length);
  /**
   * @param {number} start
   * @param {number} end
   * @param {boolean} auto
   * @param {Part["why"]} why
   */
  const mark = (start, end, auto, why) => {
    for (let i = start; i < end; i++) if (taken[i]) return;
    taken.fill(1, start, end);
    found.push({ start, end, term: text.slice(start, end), auto, why });
  };

  // Rule 1: known names, longest first so "Lake Balaton" wins over "Balaton".
  // Case matters: Iceland's "Island" must not catch "island".
  const names = [...new Set(ctx.names.filter((n) => n.length > 1))].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    const re = new RegExp(`(?<!${EDGE})${escape(name)}(?!${EDGE})`, "gu");
    for (const m of text.matchAll(re)) mark(m.index, m.index + m[0].length, true, "own");
  }

  // Rule 2: any other capitalised name, in free text.
  if (ctx.broad)
    for (const m of text.matchAll(CAPITALISED)) {
      const name = m[0].replace(/[.'’-]+$/, "");
      const lower = name.toLowerCase();
      if (NOT_PLACES.has(lower) || name.length < 2) continue;
      // An abbreviation in capitals is a plain word ("LDCs", "OPEC").
      if (/^[\p{Lu}\d-]{2,6}s?$/u.test(name)) continue;
      const other = ctx.others.has(lower);
      const water = isWater(name);
      const why = other ? "country" : water ? "water" : "place";
      mark(m.index, m.index + name.length, !other && (!water || ctx.water), why);
    }

  found.sort((a, b) => a.start - b.start);
  /** @type {Part[]} */
  const parts = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at)
      parts.push({ text: text.slice(at, f.start), term: null, auto: false, why: null });
    parts.push({ text: f.term, term: f.term, auto: f.auto, why: f.why });
    at = f.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), term: null, auto: false, why: null });
  return parts;
}
