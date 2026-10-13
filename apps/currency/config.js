/**
 * Currency sheets — settings and fixed data.
 */

import { cldrUrl } from "../../shared/cldr.js";

/** Which currency each territory uses, and its decimal places. */
export const URL_CURRENCY_DATA = cldrUrl("cldr-core", "supplemental/currencyData.json");
/** English currency names and symbols. */
export const URL_CURRENCY_NAMES = cldrUrl("cldr-numbers-full", "main/en/currencies.json");

/** Most files fetched per country, across notes and coins. */
export const MAX_FILES = 120;
/** Most images that fit on one sheet. */
export const MAX_SELECTED = 12;
/** Width of the picker thumbnails, in pixels. */
export const THUMB_W = 400;
/** Width of the renders drawn on the sheet, in pixels. */
export const FULL_W = 1200;

/**
 * Infobox rows safe to show without naming the currency. Everything else —
 * code, symbol, subunit name, central bank, users, denomination lists, which
 * carry the symbol — is the answer, and waits behind the reveal.
 */
export const SAFE_LABELS = ["date of introduction", "inflation"];

/** The article band has no heading of its own; the image speaks for itself. */
export const SECTION_LABEL = { notes: "Banknotes", coins: "Coins" };
export const SECTION_ORDER = ["notes", "coins"];
