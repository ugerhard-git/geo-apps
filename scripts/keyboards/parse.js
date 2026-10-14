/**
 * Keyboard layouts — reading one CLDR LDML keyboard file (CLDR 43, the last
 * release with the Windows layouts) into the four layers a keycap shows.
 *
 * Pure (no files, no network), so the rules can be unit-tested. The runner is
 * build-data.mjs.
 *
 * Everything is cleaned before it is written to the repository: only known
 * key positions are kept, control and invisible formatting characters are
 * dropped, and every legend is capped in length.
 */

/** The key positions drawn, by ISO 9995 name. E13 and B11 exist on a few layouts only. */
export const POSITIONS = [
  ..."E00 E01 E02 E03 E04 E05 E06 E07 E08 E09 E10 E11 E12 E13".split(" "),
  ..."D01 D02 D03 D04 D05 D06 D07 D08 D09 D10 D11 D12".split(" "),
  ..."C01 C02 C03 C04 C05 C06 C07 C08 C09 C10 C11 C12".split(" "),
  ..."B00 B01 B02 B03 B04 B05 B06 B07 B08 B09 B10 B11".split(" "),
];
const KNOWN = new Set(POSITIONS);

/** The layers a keycap can show, in the order they are stored. */
export const LAYERS = ["base", "shift", "altgr", "altgrShift"];

/** XML entities as they appear in the files. */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * A `to="…"` value as text: XML entities and CLDR's `\u{…}` escapes decoded,
 * control and invisible formatting characters removed.
 *
 * @param {string} raw
 * @returns {string} "" when nothing printable is left
 */
export function legend(raw) {
  let s = String(raw)
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[/** @type {keyof ENTITIES} */ (e)])
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, h) => safeChar(parseInt(h, 16)));
  // Controls (Cc) and invisible formatting (Cf: ZWJ, ZWNJ, direction marks)
  // can't be printed on a keycap. A no-break space prints as nothing too.
  s = s.replace(/[\p{Cc}\p{Cf}\u00a0\s]/gu, "");
  const chars = [...s];
  return chars.length > 6 ? "" : s;
}

/** @param {number} cp */
const safeChar = (cp) => (cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "");

/**
 * Which layer a `modifiers` attribute describes, if any of the four.
 * The attribute lists alternatives separated by spaces; in each, "+" joins
 * keys and "?" marks one as optional.
 *
 * @param {string | undefined} modifiers
 * @returns {"base" | "shift" | "altgr" | "altgrShift" | ""}
 */
export function layerOf(modifiers) {
  if (modifiers === undefined) return "base";
  for (const alt of modifiers.trim().split(/\s+/)) {
    const need = alt
      .split("+")
      .filter((k) => k && !k.endsWith("?"))
      .sort()
      .join("+");
    if (need === "") return "base";
    if (need === "shift") return "shift";
    if (need === "altR" || need === "alt+ctrl") return "altgr";
    if (need === "altR+shift" || need === "alt+ctrl+shift") return "altgrShift";
  }
  return "";
}

/**
 * @typedef {object} Layout
 * @property {string} name as Windows calls it
 * @property {Record<string, string[]>} keys position → [base, shift, altgr, altgrShift], "" for none
 * @property {string} dead characters that are dead keys (they wait for the next key)
 */

/**
 * Read one keyboard file.
 *
 * @param {string} xml
 * @returns {Layout}
 */
export function parseLayout(xml) {
  const name = legendText((/<name value="([^"]{1,200})"/.exec(xml) || [])[1] || "");
  /** @type {Record<string, string[]>} */
  const keys = {};
  for (const block of xml.matchAll(/<keyMap(\s[^>]*)?>([\s\S]*?)<\/keyMap>/g)) {
    const mods = (/\smodifiers="([^"]*)"/.exec(block[1] || "") || [])[1];
    const layer = LAYERS.indexOf(layerOf(mods));
    if (layer < 0) continue;
    for (const m of block[2].matchAll(/<map iso="([A-E]\d\d)" to="([^"]*)"/g)) {
      if (!KNOWN.has(m[1])) continue;
      const k = (keys[m[1]] ||= ["", "", "", ""]);
      // The first map for a layer wins: "shift caps" and "shift" can both appear.
      if (!k[layer]) k[layer] = legend(m[2]);
    }
  }
  /** @type {Set<string>} */
  const dead = new Set();
  for (const t of xml.matchAll(/<transform from="([^"]*)" to="[^"]*"/g)) {
    const from = [...legend(t[1])];
    if (from.length >= 2) dead.add(from[0]);
  }
  for (const id of Object.keys(keys)) if (keys[id].every((s) => !s)) delete keys[id];
  return { name, keys, dead: [...dead].join("") };
}

/** A display name: entities decoded, Windows' dated "(FYROM)" dropped. */
function legendText(/** @type {string} */ s) {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[/** @type {keyof ENTITIES} */ (e)])
    .replace(/\s*\(FYROM\)/g, "")
    .replace(/[\p{Cc}]/gu, "")
    .trim()
    .slice(0, 80);
}

/**
 * A layout id from a file name: "de-CH-t-k0-windows.xml" → "de-CH",
 * "en-t-k0-windows-extended.xml" → "en-extended".
 *
 * @param {string} file
 * @returns {string} "" when it isn't a keyboard file
 */
export function layoutId(file) {
  const m = /^([A-Za-z0-9-]+?)-t-k0-windows((?:-[a-z0-9]+)*)\.xml$/.exec(file);
  return m ? m[1] + m[2] : "";
}

/**
 * Whether a layout was made for ANSI keyboards (one key above Enter, none
 * left of Z): the US layout repeats the backslash on both ISO-only keys.
 *
 * @param {Record<string, string[]>} keys
 */
export function isAnsi(keys) {
  const a = keys.C12;
  const b = keys.B00;
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}
