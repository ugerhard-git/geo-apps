/**
 * Flag colours — settings and fixed data.
 */

/*
  The flag is measured from a rendering this wide. Wide enough that a thin
  stripe or a small emblem is still several pixels across, small enough that
  counting every pixel stays instant.
*/
export const SAMPLE_WIDTH = 900;

/*
  Below this alpha a pixel is treated as not part of the flag at all: Nepal's
  pennant corners, and the soft edge of any flag with transparency.
*/
export const ALPHA_FLOOR = 128;

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
  CD: ["drc", "congo kinshasa"],
  CG: ["congo brazzaville"],
  KR: ["south korea"],
  KP: ["north korea"],
  CH: ["schweiz"],
  DE: ["deutschland"],
};
