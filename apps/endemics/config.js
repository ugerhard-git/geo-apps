/**
 * Endemic animals — settings and fixed data.
 */

/** Most species articles read for one country. */
export const MAX_SPECIES = 240;
/** Most photographs that fit on one sheet. */
export const MAX_SELECTED = 6;
/*
  Render widths: small for the picker, large for the sheet. Both are among
  Wikimedia's standard thumbnail widths, which are pre-rendered and cached;
  other widths are rendered on request, slowly.
*/
export const THUMB_W = 330;
export const FULL_W = 1280;

/** What people type that CLDR doesn't list, by ISO code. */
export const ALIASES = {
  US: ["usa", "america", "united states of america"],
  GB: ["britain", "great britain", "england", "scotland", "wales"],
  NL: ["holland"],
  MM: ["burma"],
  SZ: ["swaziland"],
  CI: ["ivory coast"],
  TR: ["turkey"],
  CV: ["cape verde"],
  TL: ["east timor"],
  AE: ["uae"],
  CD: ["drc"],
  KR: ["south korea"],
  KP: ["north korea"],
  DE: ["deutschland"],
};

/** Pages that are not a species: lists, overviews, the category's own prose. */
export const NOT_A_SPECIES =
  /^(List of|Lists of|Fauna of|Wildlife of|Endemic|Index of|Outline of)\b|\b(disambiguation)\b/i;
