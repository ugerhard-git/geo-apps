/**
 * Keyboard layouts — fonts for the legends.
 *
 * Every script gets its Noto family from Google Fonts, loaded only when a
 * layout needs it. The canvas falls back glyph by glyph through the list,
 * so one font stack covers a keycap with Latin and Thai on it.
 */

/** Noto family per Unicode script. Latin, Greek, Cyrillic: Noto Sans itself. */
export const SCRIPT_FONT = {
  Arabic: "Noto Sans Arabic",
  Armenian: "Noto Sans Armenian",
  Bengali: "Noto Sans Bengali",
  Bopomofo: "Noto Sans TC",
  Canadian_Aboriginal: "Noto Sans Canadian Aboriginal",
  Cherokee: "Noto Sans Cherokee",
  Devanagari: "Noto Sans Devanagari",
  Ethiopic: "Noto Sans Ethiopic",
  Georgian: "Noto Sans Georgian",
  Gujarati: "Noto Sans Gujarati",
  Gurmukhi: "Noto Sans Gurmukhi",
  Han: "Noto Sans TC",
  Hangul: "Noto Sans KR",
  Hebrew: "Noto Sans Hebrew",
  Hiragana: "Noto Sans JP",
  Kannada: "Noto Sans Kannada",
  Katakana: "Noto Sans JP",
  Khmer: "Noto Sans Khmer",
  Lao: "Noto Sans Lao",
  Malayalam: "Noto Sans Malayalam",
  Mongolian: "Noto Sans Mongolian",
  Myanmar: "Noto Sans Myanmar",
  Nko: "Noto Sans NKo",
  Ol_Chiki: "Noto Sans Ol Chiki",
  Oriya: "Noto Sans Oriya",
  Sinhala: "Noto Sans Sinhala",
  Syriac: "Noto Sans Syriac",
  Tamil: "Noto Sans Tamil",
  Telugu: "Noto Sans Telugu",
  Thaana: "Noto Sans Thaana",
  Thai: "Noto Sans Thai",
  Tibetan: "Noto Serif Tibetan",
  Tifinagh: "Noto Sans Tifinagh",
};

/** Always loaded: Latin, Greek, Cyrillic and most symbols. */
export const BASE_FONT = "Noto Sans";

/** Script detectors, built once. */
const DETECT = Object.keys(SCRIPT_FONT).map(
  (s) => /** @type {[string, RegExp]} */ ([s, new RegExp(`\\p{Script=${s}}`, "u")]),
);

/**
 * The font families a layout's legends need, besides {@link BASE_FONT}.
 *
 * @param {Record<string, string[]>} keys
 * @returns {string[]}
 */
export function familiesFor(keys) {
  const text = Object.values(keys).flat().join("");
  /** @type {Set<string>} */
  const out = new Set();
  for (const [script, re] of DETECT)
    if (re.test(text)) out.add(SCRIPT_FONT[/** @type {keyof SCRIPT_FONT} */ (script)]);
  return [...out];
}

/** A canvas font stack: the base font, then the script fonts. */
export const fontStack = (/** @type {string[]} */ families) =>
  [BASE_FONT, ...families].map((f) => `"${f}"`).join(", ") + ", sans-serif";

const link = document.createElement("link");
link.rel = "stylesheet";
/** @type {Set<string>} */
const asked = new Set();

/**
 * Load the families (regular weight; Noto Sans also semi-bold) and wait
 * until the canvas can use them — it silently falls back otherwise.
 *
 * @param {string[]} families
 * @param {string} sample text in those scripts, so the right subsets load
 */
export async function ensureFonts(families, sample) {
  const before = asked.size;
  for (const f of families) if (/^[A-Za-z ]{3,60}$/.test(f)) asked.add(f);
  if (!link.parentNode || asked.size !== before) {
    const q = [
      `family=${BASE_FONT.replace(/ /g, "+")}:wght@400;600`,
      ...[...asked].map((f) => "family=" + f.replace(/ /g, "+")),
    ].join("&");
    // The @font-face rules only exist once the stylesheet has arrived.
    const loaded = new Promise((resolve) => {
      link.onload = link.onerror = resolve;
      setTimeout(resolve, 8000);
    });
    link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
    if (!link.parentNode) document.head.appendChild(link);
    await loaded;
  }
  if (!document.fonts || !document.fonts.load) return;
  const text = sample.slice(0, 400);
  await Promise.all(
    [BASE_FONT, ...families].flatMap((f) => [
      document.fonts.load(`400 40px "${f}"`, text).catch(() => {}),
      f === BASE_FONT ? document.fonts.load(`600 40px "${f}"`, text).catch(() => {}) : null,
    ]),
  );
}
