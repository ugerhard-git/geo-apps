/**
 * Colour values typed by people or read from colour inputs.
 * @module shared/colour
 */

/** A six-digit hex colour, with or without the leading "#". */
export const HEX6 = /^#?([0-9a-f]{6})$/i;

/**
 * Return `value` as a lower-case `#rrggbb` string, or `fallback` when it is not
 * a six-digit hex colour. Use this before handing a colour to the canvas.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export const safeColour = (value, fallback) => {
  const m = HEX6.exec(String(value || ""));
  return m ? "#" + m[1].toLowerCase() : fallback;
};

/**
 * Parse what someone typed into a hex field. Accepts `#abc`, `abc`, `#aabbcc`
 * and `aabbcc`; returns `#aabbcc`, or `null` when it is not a colour yet.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function parseHex(raw) {
  const t = String(raw || "")
    .trim()
    .replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t))
    return (
      "#" +
      t
        .toLowerCase()
        .split("")
        .map((c) => c + c)
        .join("")
    );
  if (/^[0-9a-f]{6}$/i.test(t)) return "#" + t.toLowerCase();
  return null;
}
