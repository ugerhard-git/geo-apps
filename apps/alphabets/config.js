/**
 * Alphabets — settings and fixed data.
 */

import { CLDR_VERSION, cldrUrl } from "../../shared/cldr.js";
import { NPM_CDN } from "../../shared/net.js";

export { NPM_CDN };

export const URL_TERRITORY_INFO = cldrUrl("cldr-core", "supplemental/territoryInfo.json");
export const URL_LANGUAGE_DATA = cldrUrl("cldr-core", "supplemental/languageData.json");
export const URL_LANG_NAMES = cldrUrl("cldr-localenames-full", "main/en/languages.json");
export const URL_TERR_NAMES = cldrUrl("cldr-localenames-full", "main/en/territories.json");

/*
  Locale and UDHR codes come out of downloaded JSON, so they are checked
  against their expected shape before being pasted into a path. Without this a
  tampered mirror could steer the request at a different file.
*/
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})*$/;
const UDHR_RE = /^[a-z]{3}(_[a-z]{2,6})?$/;

/**
 * Where CLDR keeps a locale's character sets.
 *
 * @param {string} locale e.g. "sr-Latn"
 * @returns {string}
 */
export function charactersUrl(locale) {
  if (!LOCALE_RE.test(locale)) throw new Error("unexpected locale code");
  return `${NPM_CDN}/cldr-misc-full@${CLDR_VERSION}/main/${locale}/characters.json`;
}

/**
 * Where the udhr package keeps one translation of the Universal Declaration
 * of Human Rights.
 *
 * @param {string} code e.g. "deu"
 * @returns {string}
 */
export function udhrUrl(code) {
  if (!UDHR_RE.test(code)) throw new Error("unexpected UDHR code");
  return `${NPM_CDN}/udhr@6/declaration/${code}.html`;
}

/** Percent of the population a language needs to be offered, unless official. */
export const MIN_SHARE = 5;
/** Most alphabets on one sheet. */
export const MAX_LANGS = 4;
/** The sheet is always this size. */
export const SHEET_W = 2400;
export const SHEET_H = 1600;
/** Below this glyph size the sheet gets a warning. */
export const LEGIBLE_PX = 34;
/** A sheet can't usefully show more characters than this per alphabet. */
export const MAX_CELLS = 150;
/** Hard ceiling on a parsed character set. */
export const MAX_SET = 8000;

/**
 * Script detection by code point. Used for three things that differ by
 * script: which font to load, whether the chart reads right to left, and
 * whether case pairs make any sense.
 *
 * @type {Array<[string, Array<[number, number]>]>}
 */
export const SCRIPT_RANGES = [
  [
    "Latin",
    [
      [0x41, 0x24f],
      [0x1e00, 0x1eff],
      [0x250, 0x2af],
      [0x2b0, 0x2ff],
    ],
  ],
  [
    "Greek",
    [
      [0x370, 0x3ff],
      [0x1f00, 0x1fff],
    ],
  ],
  [
    "Cyrillic",
    [
      [0x400, 0x52f],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
    ],
  ],
  ["Armenian", [[0x530, 0x58f]]],
  ["Hebrew", [[0x590, 0x5ff]]],
  [
    "Arabic",
    [
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x8a0, 0x8ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  ],
  ["Syriac", [[0x700, 0x74f]]],
  ["Thaana", [[0x780, 0x7bf]]],
  ["NKo", [[0x7c0, 0x7ff]]],
  ["Devanagari", [[0x900, 0x97f]]],
  ["Bengali", [[0x980, 0x9ff]]],
  ["Gurmukhi", [[0xa00, 0xa7f]]],
  ["Gujarati", [[0xa80, 0xaff]]],
  ["Oriya", [[0xb00, 0xb7f]]],
  ["Tamil", [[0xb80, 0xbff]]],
  ["Telugu", [[0xc00, 0xc7f]]],
  ["Kannada", [[0xc80, 0xcff]]],
  ["Malayalam", [[0xd00, 0xd7f]]],
  ["Sinhala", [[0xd80, 0xdff]]],
  ["Thai", [[0xe00, 0xe7f]]],
  ["Lao", [[0xe80, 0xeff]]],
  ["Tibetan", [[0xf00, 0xfff]]],
  ["Myanmar", [[0x1000, 0x109f]]],
  [
    "Georgian",
    [
      [0x10a0, 0x10ff],
      [0x1c90, 0x1cbf],
    ],
  ],
  ["Ethiopic", [[0x1200, 0x139f]]],
  ["Cherokee", [[0x13a0, 0x13ff]]],
  ["Khmer", [[0x1780, 0x17ff]]],
  ["Mongolian", [[0x1800, 0x18af]]],
  [
    "Hangul",
    [
      [0x1100, 0x11ff],
      [0x3130, 0x318f],
      [0xac00, 0xd7af],
    ],
  ],
  ["Hiragana", [[0x3040, 0x309f]]],
  ["Katakana", [[0x30a0, 0x30ff]]],
  [
    "Han",
    [
      [0x3400, 0x4dbf],
      [0x4e00, 0x9fff],
      [0xf900, 0xfaff],
    ],
  ],
];

export const RTL_SCRIPTS = new Set(["Arabic", "Hebrew", "Syriac", "Thaana", "NKo"]);

/** Google font family per script. Only what's on screen gets loaded. */
export const SCRIPT_FONT = {
  Latin: "Noto Sans",
  Greek: "Noto Sans",
  Cyrillic: "Noto Sans",
  Armenian: "Noto Sans Armenian",
  Hebrew: "Noto Sans Hebrew",
  Arabic: "Noto Sans Arabic",
  Syriac: "Noto Sans Syriac",
  Thaana: "Noto Sans Thaana",
  NKo: "Noto Sans NKo",
  Devanagari: "Noto Sans Devanagari",
  Bengali: "Noto Sans Bengali",
  Gurmukhi: "Noto Sans Gurmukhi",
  Gujarati: "Noto Sans Gujarati",
  Oriya: "Noto Sans Oriya",
  Tamil: "Noto Sans Tamil",
  Telugu: "Noto Sans Telugu",
  Kannada: "Noto Sans Kannada",
  Malayalam: "Noto Sans Malayalam",
  Sinhala: "Noto Sans Sinhala",
  Thai: "Noto Sans Thai",
  Lao: "Noto Sans Lao",
  Tibetan: "Noto Serif Tibetan",
  Myanmar: "Noto Sans Myanmar",
  Georgian: "Noto Sans Georgian",
  Ethiopic: "Noto Sans Ethiopic",
  Cherokee: "Noto Sans Cherokee",
  Khmer: "Noto Sans Khmer",
  Mongolian: "Noto Sans Mongolian",
  Hangul: "Noto Sans KR",
  Hiragana: "Noto Sans JP",
  Katakana: "Noto Sans JP",
  Han: "Noto Sans SC",
};

/**
 * BCP-47 to the UDHR file codes used by the udhr package. Only languages that
 * can be mapped with confidence appear here; anything missing gets an honest
 * "no sourced sample text" rather than an invented sentence.
 *
 * @type {Record<string, string[]>}
 */
export const UDHR_CODE = {
  en: ["eng"],
  de: ["deu"],
  fr: ["fra"],
  es: ["spa"],
  it: ["ita"],
  pt: ["por"],
  nl: ["nld"],
  sv: ["swe"],
  da: ["dan"],
  fi: ["fin"],
  is: ["isl"],
  nb: ["nob"],
  nn: ["nno"],
  no: ["nob"],
  pl: ["pol"],
  cs: ["ces"],
  sk: ["slk"],
  hu: ["hun"],
  ro: ["ron"],
  bg: ["bul"],
  ru: ["rus"],
  uk: ["ukr"],
  be: ["bel"],
  sr: ["srp"],
  hr: ["hrv"],
  bs: ["bos"],
  sl: ["slv"],
  mk: ["mkd"],
  sq: ["als", "sqi"],
  el: ["ell"],
  tr: ["tur"],
  ar: ["arb"],
  he: ["heb"],
  fa: ["pes"],
  ur: ["urd"],
  hi: ["hnd", "hin"],
  bn: ["ben"],
  ta: ["tam"],
  te: ["tel"],
  ml: ["mal"],
  kn: ["kan"],
  gu: ["guj"],
  pa: ["pan"],
  mr: ["mar"],
  ne: ["nep"],
  si: ["snh"],
  th: ["tha"],
  lo: ["lao"],
  km: ["khm"],
  my: ["mya"],
  vi: ["vie"],
  id: ["ind"],
  ms: ["zlm", "mly"],
  tl: ["tgl"],
  ja: ["jpn"],
  ko: ["kkn", "kor"],
  zh: ["cmn_hans", "cmn_hant"],
  am: ["amh"],
  sw: ["swh"],
  zu: ["zul"],
  xh: ["xho"],
  af: ["afr"],
  yo: ["yor"],
  ig: ["ibo"],
  ha: ["hau"],
  so: ["som"],
  mn: ["khk"],
  ka: ["kat"],
  hy: ["hye"],
  az: ["azj"],
  kk: ["kaz"],
  uz: ["uzn"],
  ky: ["kir"],
  tg: ["tgk"],
  et: ["est"],
  lv: ["lvs", "lav"],
  lt: ["lit"],
  ga: ["gle"],
  cy: ["cym"],
  mt: ["mlt"],
  eu: ["eus"],
  ca: ["cat"],
  gl: ["glg"],
};
