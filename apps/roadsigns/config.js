/**
 * Road signs — settings and fixed data.
 */

/** What people type that neither Commons nor CLDR lists, by ISO code. */
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
  CD: ["drc", "congo kinshasa"],
  CG: ["congo brazzaville"],
  KR: ["south korea"],
  KP: ["north korea"],
  AE: ["uae"],
  CH: ["schweiz", "suisse"],
  DE: ["deutschland"],
  AT: ["osterreich"],
};

/*
  New Zealand's regulatory SVGs alone run to 244 files. A small cap silently
  kept whichever ones Commons listed first, which is why its give-way sign
  never appeared: "R2-3" sorts too late to survive a cut at 26.
*/
/** Most files fetched for one country, across all sign classes. */
export const MAX_FILES = 1800;
/** Most files fetched for one sign class. */
export const MAX_PER_CLASS = 300;
/** Most signs that fit on one sheet. */
export const MAX_SELECTED = 16;
/** Width of the picker thumbnails, in pixels. */
export const THUMB_W = 320;
/** Width of the renders drawn on the sheet, in pixels. */
export const FULL_W = 1000;

/*
  Commons keeps photographs under "Road signs IN X" and the official artwork
  under "Diagrams of road signs OF X". The artwork is what belongs on a sheet,
  so the country list comes from the diagrams tree.
*/
export const ROOT_CATEGORY = "Category:Diagrams of road signs by country";
export const NAME_PREFIX = "Diagrams of road signs of ";

/**
 * Sign classes, in the order they read on a sheet.
 *
 * Countries do not agree on how to classify signs, and the categories follow
 * that. Vienna Convention countries split regulation into prohibitory,
 * mandatory and priority; the MUTCD countries — the United States, Australia,
 * Canada, New Zealand and others — use a single "regulatory" class and have no
 * category under the Vienna names at all. So most countries fill some of these
 * and not others, and an empty class is the norm rather than a fault.
 */
export const SECTIONS = [
  { id: "warning", label: "Warning", type: "warning" },
  { id: "regulatory", label: "Regulatory", type: "regulatory" },
  { id: "prohibitory", label: "Prohibitory", type: "prohibitory" },
  { id: "mandatory", label: "Mandatory", type: "mandatory" },
  { id: "priority", label: "Priority", type: "priority" },
  { id: "information", label: "Information", type: "information" },
];
export const SECTION_ORDER = SECTIONS.map((s) => s.id);
export const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]));

/*
  A sign whose name says it is historic or obsolete is a different puzzle.
*/
export const HISTORIC = /\b(historic|historical|obsolete|former|18\d\d|19[0-8]\d)\b/i;
