/**
 * Licence plates — settings and fixed data.
 */

/**
 * Infobox rows allowed onto the exported sheet. Country code is the obvious
 * giveaway, but issuer names a national agency, slogan identifies a state, and
 * the country row says it outright — so the sheet carries only rows that
 * describe the plate itself.
 */
export const SHEET_FIELDS = [
  "front plate",
  "rear plate",
  "size",
  "serial format",
  "material",
  "colour (front)",
  "colour (rear)",
  "color (front)",
  "color (rear)",
  "introduced",
];

/*
  Commons names these "License plates of X". "Vehicle registration plates" is
  the English Wikipedia title, which Commons records only as an interwiki
  equivalent — using it returns an empty list rather than an error. Several
  roots are tried, then a prefix scan, so a rename can't take the app down
  silently again.
*/
export const ROOT_CATEGORIES = [
  "Category:License plates by country",
  "Category:Licence plates by country",
  "Category:Vehicle registration plates by country",
  "Category:Number plates by country",
];
export const NAME_PREFIXES = [
  "License plates of ",
  "Licence plates of ",
  "Vehicle registration plates of ",
  "Number plates of ",
];

/*
  A generous cap, because the filters make a long list usable: a small one
  silently kept whichever files Commons happened to list first.
*/
/** Most files fetched per country, across subcategories. */
export const MAX_FILES = 400;
/** Most plates that fit on one sheet. */
export const MAX_SELECTED = 12;
/** Width of the picker thumbnails, in pixels. */
export const THUMB_W = 400;
/** Width of the renders drawn on the sheet: plenty, far less than originals. */
export const FULL_W = 1200;

/** CLDR codes that are not countries. Kosovo is left out too: Commons files it apart. */
export const NOT_A_COUNTRY = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ", "XK"]);

/**
 * Words that suggest a plate isn't for an ordinary private car, tried in
 * order; the first match decides the section.
 *
 * @type {Array<[string, RegExp]>}
 */
export const SECTION_HINTS = [
  // Whole words where a prefix would over-match — "van" must not catch "vanity".
  ["other", /\b(army|police|dealer|export|trade)\b/i],
  ["commercial", /\b(bus|van|hgv|taxi|goods|cargo|coach)\b/i],
  // Prefixes, with a leading boundary only, so "diplomatic" and "military" match.
  [
    "other",
    /\b(diplomat|militar|temporar|transit|motorcycle|moped|tractor|agricultur|historic|vintage|oldtimer|classic)/i,
  ],
  ["commercial", /\b(commercial|lorr|truck|haulage|trailer|transport|utility)/i],
];

/** The sheet's sections, in the order they are drawn. */
export const SECTION_ORDER = ["private", "commercial", "other"];
export const SECTION_LABEL = {
  private: "Private vehicles",
  commercial: "Commercial vehicles",
  other: "Other plates",
};
