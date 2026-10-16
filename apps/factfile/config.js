/**
 * Fact file — the fields a card can show, and fixed settings.
 */

/** The groups the field list is arranged under. */
export const GROUPS = [
  { id: "land", name: "Land" },
  { id: "economy", name: "Economy" },
  { id: "people", name: "People" },
  { id: "politics", name: "Political system" },
];

/**
 * @typedef {object} Field
 * @property {string} id the key in a country's data file
 * @property {string} group one of {@link GROUPS}
 * @property {string} label printed on the card
 * @property {boolean} on ticked to start with
 * @property {boolean} [broad] black out every place name in it, not just
 *   the country's known names (lists of languages or religions are all
 *   names, and are left to the known names)
 */

/** @type {Field[]} */
export const FIELDS = [
  { id: "climate", group: "land", label: "Climate", on: true, broad: true },
  { id: "terrain", group: "land", label: "Terrain", on: true, broad: true },
  { id: "heights", group: "land", label: "Height", on: true },
  { id: "coast", group: "land", label: "Coastline", on: true },
  { id: "borders", group: "land", label: "Borders", on: true },
  { id: "hazards", group: "land", label: "Natural hazards", on: false, broad: true },
  { id: "area", group: "land", label: "Area", on: false },
  { id: "lake", group: "land", label: "Largest lake", on: false },
  { id: "river", group: "land", label: "Longest river", on: false },
  { id: "resources", group: "economy", label: "Natural resources", on: true, broad: true },
  { id: "farm", group: "economy", label: "Farm products", on: true, broad: true },
  { id: "exports", group: "economy", label: "Main exports", on: true, broad: true },
  { id: "industries", group: "economy", label: "Industries", on: false, broad: true },
  { id: "city", group: "people", label: "Biggest city", on: true },
  { id: "languages", group: "people", label: "Languages", on: false },
  { id: "religions", group: "people", label: "Religions", on: false },
  { id: "age", group: "people", label: "Age", on: false },
  { id: "system", group: "politics", label: "System of government", on: true, broad: true },
  { id: "parliament", group: "politics", label: "Parliament", on: true },
  { id: "independence", group: "politics", label: "Independence", on: true, broad: true },
  { id: "regions", group: "politics", label: "Regions", on: true },
  { id: "legal", group: "politics", label: "Legal system", on: false, broad: true },
  { id: "suffrage", group: "politics", label: "Voting", on: false, broad: true },
  { id: "holiday", group: "politics", label: "National holiday", on: false },
  { id: "military", group: "politics", label: "Military service", on: false, broad: true },
  { id: "memberships", group: "politics", label: "Memberships", on: false },
  { id: "colours", group: "politics", label: "National colours", on: false },
];

/** The source line printed on the card. */
export const SOURCE_LINE = "CIA World Factbook, as of January 2026 · public domain";

/** A data file bigger than this isn't one of ours. */
export const MAX_FILE_BYTES = 200_000;
